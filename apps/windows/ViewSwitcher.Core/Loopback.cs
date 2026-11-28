using System.Net;
using System.Net.Sockets;

namespace ViewSwitcher.Core;

/// <summary>
/// HTTP to this computer's own server. On Windows a connection refused (nothing listening yet) is retried
/// by TCP for about 2 s before it fails, which a probe would take for a busy server. With no SYN
/// retransmissions (SIO_TCP_INITIAL_RTO) the refusal comes at once, as on macOS. Never through a proxy.
/// </summary>
public static class Loopback
{
    const int SIO_TCP_INITIAL_RTO = unchecked((int)0x98000011);
    /// <summary>TCP_INITIAL_RTO_PARAMETERS: Rtt unspecified (0xFFFF), MaxSynRetransmissions none (0xFE).</summary>
    static readonly byte[] NoSynRetransmissions = [0xFF, 0xFF, 0xFE, 0x00];

    public static SocketsHttpHandler Handler() => new()
    {
        UseProxy = false,
        PooledConnectionLifetime = TimeSpan.FromMinutes(1),
        ConnectCallback = Connect,
    };

    public static HttpClient Client() => new(Handler()) { Timeout = Timeout.InfiniteTimeSpan };

    static async ValueTask<Stream> Connect(SocketsHttpConnectionContext ctx, CancellationToken ct)
    {
        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            if (OperatingSystem.IsWindows())
            {
                try { socket.IOControl(SIO_TCP_INITIAL_RTO, NoSynRetransmissions, null); } catch (SocketException) { }
            }
            await socket.ConnectAsync(ctx.DnsEndPoint, ct);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }
}
