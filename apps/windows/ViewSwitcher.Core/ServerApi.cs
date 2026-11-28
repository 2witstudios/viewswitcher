using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ViewSwitcher.Core;

/// <summary>What GET /api/info answers, only to this computer itself (a mac route; gate.ts isMac).</summary>
public sealed record ServerInfo(string Library, int? Port = null, bool? Sidecar = null, int? ParentPid = null, int? Pid = null, string? ClaudeCode = null, string? Stdio = null)
{
    /// <summary>
    /// A server an earlier run of the app started and then lost (a crash, an end task). The Job Object
    /// usually takes it with the app; one that's still there is replaced rather than attached to.
    /// </summary>
    public bool IsOrphan(int ownPid, Func<int, bool> isAlive) =>
        Sidecar == true && ParentPid is int parent && parent != ownPid && Pid is not null && !isAlive(parent);
}

public sealed record ObsSetupResult(IReadOnlyList<string> Missing, bool Switched);

public sealed class ServerApiException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

/// <summary>The server calls the app makes, typed (Kit's ServerAPI). Every call goes to this computer's own server.</summary>
public sealed class ServerApi(Uri baseUri, string? adminToken = null, TimeSpan? timeout = null)
{
    /// <summary>One client, never through a proxy: loopback only.</summary>
    static readonly HttpClient Http = Loopback.Client();

    public Uri Base { get; } = baseUri;
    readonly TimeSpan timeout = timeout ?? TimeSpan.FromSeconds(30);

    /// <summary>A server this app didn't start (bun run dev) has another secret and answers 404.</summary>
    public const string PairingNeedsOwnServer = "Pairing works with the server this app starts. Quit the other ViewSwitcher server (bun run dev), then choose Restart Server.";

    public Task<ServerInfo> Info() => Get<ServerInfo>("api/info");
    public Task<ObsSetupResult> SetUpObs() => Post<ObsSetupResult>("api/obs/setup", new { });
    /// <summary>The Claude Desktop extension made for this install.</summary>
    public Task<byte[]> AgentExtension() => Bytes("api/agent/viewswitcher.mcpb");

    public Task<RemoteStatus> RemoteStatus() => Remote("api/remote", null);
    public Task<RemoteStatus> SetRemoteEnabled(bool on) => Remote("api/remote", new { enabled = on });
    public Task<RemoteStatus> NewPairingCode() => Remote("api/remote/code", new { });
    public Task<RemoteStatus> RemoveDevice(string id) => Remote("api/remote/remove", new { id });

    async Task<RemoteStatus> Remote(string path, object? body)
    {
        try
        {
            return await Send<RemoteStatus>(path, body, admin: true);
        }
        catch (ServerApiException e) when (e.Status == 404)
        {
            throw new ServerApiException(404, PairingNeedsOwnServer);
        }
    }

    Task<T> Get<T>(string path) => Send<T>(path, null, false);
    Task<T> Post<T>(string path, object body) => Send<T>(path, body, false);

    async Task<T> Send<T>(string path, object? body, bool admin)
    {
        var bytes = await Call(path, body, admin);
        try
        {
            return JsonSerializer.Deserialize<T>(bytes, Json.Options) ?? throw new JsonException("null");
        }
        catch (JsonException)
        {
            throw new ServerApiException(200, $"The server's answer didn't make sense ({typeof(T).Name}).");
        }
    }

    Task<byte[]> Bytes(string path) => Call(path, null, false);

    /// <summary>GET, or POST <paramref name="body"/> as JSON; the body of a 200, else the server's own reason.</summary>
    async Task<byte[]> Call(string path, object? body, bool admin)
    {
        using var cts = new CancellationTokenSource(timeout);
        using var req = new HttpRequestMessage(body is null ? HttpMethod.Get : HttpMethod.Post, new Uri(Base, path));
        req.Headers.CacheControl = new() { NoCache = true };
        if (admin && adminToken is not null) req.Headers.Add("x-viewswitcher-admin", adminToken);
        // No Origin, as from the Mac app: not a page, so origin.ts lets it through (the admin calls carry the secret).
        if (body is not null) req.Content = JsonContent.Create(body, options: Json.Options);
        using var res = await Http.SendAsync(req, cts.Token);
        var data = await res.Content.ReadAsByteArrayAsync(cts.Token);
        if (res.StatusCode != HttpStatusCode.OK)
        {
            string? reason = null;
            try
            {
                using var doc = JsonDocument.Parse(data);
                if (doc.RootElement.TryGetProperty("error", out var e)) reason = e.GetString();
            }
            catch (JsonException) { }
            throw new ServerApiException((int)res.StatusCode, reason ?? $"The server said no ({(int)res.StatusCode}).");
        }
        return data;
    }
}

public static class Processes
{
    /// <summary>Whether a process with this pid is running.</summary>
    public static bool Alive(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            return !p.HasExited;
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return true; // there, but not ours to look at
        }
    }

    /// <summary>The executable a process runs, or null when it can't be read (gone, another user's).</summary>
    public static string? ExecutablePath(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            return p.MainModule?.FileName;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
