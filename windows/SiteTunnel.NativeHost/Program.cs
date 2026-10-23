using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;

namespace SiteTunnel.NativeHost;

internal static class Program
{
    private static readonly string Root = AppContext.BaseDirectory;
    private static readonly string TorDir = Path.Combine(Root, "Tor");
    private static readonly string TorExe = Path.Combine(TorDir, "tor.exe");
    private static readonly string StateDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SiteTunnel", "Tor");
    private static readonly string Torrc = Path.Combine(StateDir, "sitetunnel.torrc");
    private static readonly string PidFile = Path.Combine(StateDir, "sitetunnel.pid");
    private static Process? _tor;

    private static async Task<int> Main()
    {
        while (true)
        {
            var header = new byte[4];
            if (!await ReadExactAsync(Console.OpenStandardInput(), header)) break;
            var length = BitConverter.ToInt32(header, 0);
            if (length is < 2 or > 1024 * 1024) break;
            var payload = new byte[length];
            if (!await ReadExactAsync(Console.OpenStandardInput(), payload)) break;
            using var doc = JsonDocument.Parse(payload);
            var command = doc.RootElement.TryGetProperty("command", out var c) ? c.GetString() : "";
            object result;
            try
            {
                result = command switch
                {
                    "START_TOR" => await StartTorAsync(),
                    "STOP_TOR" => StopTor(),
                    "TOR_STATUS" => await StatusAsync(),
                    _ => new { ok = false, error = "Unknown command." }
                };
            }
            catch (Exception ex) { result = new { ok = false, error = ex.Message }; }
            await WriteMessageAsync(result);
        }
        return 0;
    }

    private static async Task<object> StartTorAsync()
    {
        if (!File.Exists(TorExe))
            return new { ok = false, running = false, error = "Bundled Tor runtime is missing. Repair the SiteTunnel installation." };

        Directory.CreateDirectory(TorDir);
        Directory.CreateDirectory(StateDir);
        await File.WriteAllTextAsync(Torrc, string.Join(Environment.NewLine, new[]
        {
            "SocksPort 127.0.0.1:9150",
            "SocksPolicy accept 127.0.0.1",
            "SocksPolicy reject *",
            "DataDirectory " + Path.Combine(StateDir, "Data").Replace("\\", "/"),
            "Log notice stdout",
            "SafeLogging 1"
        }) + Environment.NewLine);

        if (await IsPortOpenAsync(9150))
            return new { ok = true, running = true, alreadyRunning = true, proxy = "socks5://127.0.0.1:9150", message = "Tor SOCKS port is already listening." };

        var start = new ProcessStartInfo(TorExe, "-f \"" + Torrc + "\"")
        {
            WorkingDirectory = TorDir, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true
        };
        _tor = Process.Start(start) ?? throw new InvalidOperationException("Windows could not start Tor.");
        await File.WriteAllTextAsync(PidFile, _tor.Id.ToString());
        _ = DrainAsync(_tor.StandardOutput);
        _ = DrainAsync(_tor.StandardError);

        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            if (_tor.HasExited) throw new InvalidOperationException("Tor exited during startup. Check the installation and Windows security software.");
            if (await IsPortOpenAsync(9150))
                return new { ok = true, running = true, proxy = "socks5://127.0.0.1:9150", message = "Tor has started. Network bootstrap may still be in progress." };
            await Task.Delay(250);
        }
        return new { ok = false, running = false, error = "Tor did not open its SOCKS port within 30 seconds." };
    }

    private static object StopTor()
    {
        try
        {
            if (File.Exists(PidFile) && int.TryParse(File.ReadAllText(PidFile).Trim(), out var pid))
            {
                using var process = Process.GetProcessById(pid);
                var actual = process.MainModule?.FileName;
                if (!string.IsNullOrWhiteSpace(actual) &&
                    string.Equals(Path.GetFullPath(actual), Path.GetFullPath(TorExe), StringComparison.OrdinalIgnoreCase))
                    process.Kill(true);
            }
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
        try { File.Delete(PidFile); } catch { }
        return new { ok = true, running = false, message = "Tor stop requested." };
    }

    private static async Task<object> StatusAsync()
    {
        var listening = await IsPortOpenAsync(9150);
        return new { ok = true, running = listening, proxy = listening ? "socks5://127.0.0.1:9150" : "", message = listening ? "SOCKS port is reachable; Tor network bootstrap is not yet verified." : "Tor is not listening." };
    }

    private static async Task<bool> IsPortOpenAsync(int port)
    {
        try
        {
            using var client = new TcpClient();
            using var timeout = new CancellationTokenSource(500);
            await client.ConnectAsync(IPAddress.Loopback, port, timeout.Token);
            return true;
        }
        catch { return false; }
    }

    private static async Task DrainAsync(StreamReader reader)
    {
        try { while (await reader.ReadLineAsync() is { } line) Console.Error.WriteLine("[Tor] " + line); } catch { }
    }

    private static async Task<bool> ReadExactAsync(Stream stream, byte[] buffer)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, buffer.Length - offset));
            if (read == 0) return false;
            offset += read;
        }
        return true;
    }

    private static async Task WriteMessageAsync(object value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        var output = Console.OpenStandardOutput();
        await output.WriteAsync(BitConverter.GetBytes(bytes.Length));
        await output.WriteAsync(bytes);
        await output.FlushAsync();
    }
}
