using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace ViewSwitcher.Windows;

/// <summary>Open at Login: the per-user Run key, off by default (a server starting at every login surprises someone who streams once a week).</summary>
public static class LoginItem
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    static string Name => Env.Dev ? "ViewSwitcher (development)" : "ViewSwitcher";

    public static bool Enabled
    {
        get
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKey);
            return k?.GetValue(Name) is string;
        }
        set
        {
            using var k = Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) k.SetValue(Name, $"\"{Environment.ProcessPath}\" --login");
            else k.DeleteValue(Name, throwOnMissingValue: false);
        }
    }
}

/// <summary>
/// What phones on the Wi-Fi need from Windows: an inbound firewall rule for the server on private
/// networks, and the Wi-Fi itself marked private (Windows blocks inbound connections on a public one).
/// Checking needs no rights; setting it up asks once, through Windows' own admin prompt.
/// </summary>
public static class WindowsNetwork
{
    public const string RuleName = "ViewSwitcher (phones and tablets)";

    /// <summary>Whether the firewall rule is there (netsh answers 0 when it finds it).</summary>
    public static async Task<bool> RuleExists()
    {
        var r = await Run("netsh", ["advfirewall", "firewall", "show", "rule", $"name={RuleName}"]);
        return r.Code == 0;
    }

    public sealed record Connection(string Alias, string Category);

    /// <summary>The connected networks and how Windows treats them (Public, Private, DomainAuthenticated).</summary>
    public static async Task<List<Connection>> Connections()
    {
        var r = await Run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-NetConnectionProfile | ForEach-Object { \"$($_.InterfaceAlias)`t$($_.NetworkCategory)\" }"]);
        return r.Out.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(l => l.Split('\t'))
            .Where(p => p.Length == 2)
            .Select(p => new Connection(p[0], p[1]))
            .ToList();
    }

    /// <summary>
    /// The one admin step: allow the server in on private networks, and (when asked) mark the named
    /// connections private. Windows shows its own prompt; returns whether it ran.
    /// </summary>
    public static async Task<bool> SetUp(string serverExe, int port, IEnumerable<string> makePrivate)
    {
        static string Q(string s) => "'" + s.Replace("'", "''") + "'";
        var script = string.Join("; ", new[]
        {
            $"netsh advfirewall firewall delete rule name={Q(RuleName)} | Out-Null",
            $"netsh advfirewall firewall add rule name={Q(RuleName)} dir=in action=allow program={Q(serverExe)} enable=yes profile=private,domain protocol=TCP localport={port} | Out-Null",
        }.Concat(makePrivate.Select(a => $"Set-NetConnectionProfile -InterfaceAlias {Q(a)} -NetworkCategory Private")));
        var info = new ProcessStartInfo("powershell.exe")
        {
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        foreach (var a in new[] { "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script }) info.ArgumentList.Add(a);
        try
        {
            using var p = Process.Start(info);
            if (p is null) return false;
            await p.WaitForExitAsync();
            return p.ExitCode == 0;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return false; // the prompt was declined
        }
    }

    static async Task<(int Code, string Out)> Run(string exe, string[] args)
    {
        var info = new ProcessStartInfo(exe) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in args) info.ArgumentList.Add(a);
        try
        {
            using var p = Process.Start(info)!;
            var output = await p.StandardOutput.ReadToEndAsync();
            await p.WaitForExitAsync();
            return (p.ExitCode, output);
        }
        catch (Exception)
        {
            return (-1, "");
        }
    }
}

/// <summary>
/// Announces the switcher on the local network as "ViewSwitcher" (_http._tcp), like the Mac's Bonjour,
/// so a phone's ViewSwitcher app can find this PC by name. Windows 10 and later have their own mDNS
/// responder (DnsServiceRegister); the registration lasts until Stop or the app's exit.
/// </summary>
public sealed partial class Announcer
{
    nint instance;
    nint request;
    int port;
    static readonly RegisterComplete Callback = (_, _, inst) => { if (inst != 0) DnsServiceFreeInstance(inst); };

    public void Set(bool on, int port)
    {
        if (on && this.instance != 0 && this.port == port) return;
        Stop();
        if (!on) return;
        try { Start(port); } catch (Exception) { Stop(); }
    }

    unsafe void Start(int port)
    {
        this.port = port;
        var host = $"{Environment.MachineName}.local";
        var keys = new[] { Marshal.StringToHGlobalUni("path") };
        var values = new[] { Marshal.StringToHGlobalUni("/") };
        try
        {
            fixed (nint* k = keys, v = values)
            {
                instance = DnsServiceConstructInstance("ViewSwitcher._http._tcp.local", host, 0, 0, (ushort)port, 0, 0, 1, (nint)k, (nint)v);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(keys[0]);
            Marshal.FreeHGlobal(values[0]);
        }
        if (instance == 0) return;
        var req = new DNS_SERVICE_REGISTER_REQUEST
        {
            Version = 1, // DNS_QUERY_REQUEST_VERSION1
            InterfaceIndex = 0,
            pServiceInstance = instance,
            pRegisterCompletionCallback = Marshal.GetFunctionPointerForDelegate(Callback),
        };
        request = Marshal.AllocHGlobal(Marshal.SizeOf<DNS_SERVICE_REGISTER_REQUEST>());
        Marshal.StructureToPtr(req, request, false);
        var status = DnsServiceRegister(request, 0);
        if (status != 9506 /* DNS_REQUEST_PENDING */ && status != 0) Stop();
    }

    public void Stop()
    {
        if (request != 0)
        {
            try { DnsServiceDeRegister(request, 0); } catch (Exception) { }
            Marshal.FreeHGlobal(request);
            request = 0;
        }
        if (instance != 0)
        {
            DnsServiceFreeInstance(instance);
            instance = 0;
        }
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    delegate void RegisterComplete(uint status, nint context, nint instance);

    [StructLayout(LayoutKind.Sequential)]
    struct DNS_SERVICE_REGISTER_REQUEST
    {
        public uint Version;
        public uint InterfaceIndex;
        public nint pServiceInstance;
        public nint pRegisterCompletionCallback;
        public nint pQueryContext;
        public nint hCredentials;
        public int unicastEnabled;
    }

    [LibraryImport("dnsapi.dll", StringMarshalling = StringMarshalling.Utf16)]
    private static partial nint DnsServiceConstructInstance(string serviceName, string hostName, nint ip4, nint ip6, ushort port, ushort priority, ushort weight, uint propertiesCount, nint keys, nint values);

    [LibraryImport("dnsapi.dll")]
    private static partial uint DnsServiceRegister(nint request, nint cancel);

    [LibraryImport("dnsapi.dll")]
    private static partial uint DnsServiceDeRegister(nint request, nint cancel);

    [LibraryImport("dnsapi.dll")]
    private static partial void DnsServiceFreeInstance(nint instance);
}
