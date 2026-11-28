using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using Velopack;

namespace ViewSwitcher.Windows;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        // Velopack's install, update and uninstall hooks run here and exit; a normal start carries on.
        VelopackApp.Build().SetAutoApplyOnStartup(false).Run();
        WinRT.ComWrappersSupport.InitializeComWrappers();

        // One ViewSwitcher at a time (per build): a second launch brings the first one's window forward.
        // The end-to-end run has its own, so it never meets the installed app.
        var key = Env.E2E ? $"ViewSwitcher-e2e-{Environment.ProcessId}" : Env.Dev ? "ViewSwitcher-dev" : "ViewSwitcher";
        var instance = AppInstance.FindOrRegisterForKey(key);
        if (!instance.IsCurrent)
        {
            instance.RedirectActivationToAsync(AppInstance.GetCurrent().GetActivatedEventArgs()).AsTask().Wait();
            return 0;
        }
        instance.Activated += (_, _) => Dispatch(() => App.Current.Activated());

        Application.Start(_ =>
        {
            var queue = DispatcherQueue.GetForCurrentThread();
            Ui = queue;
            SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(queue));
            new App(startHidden: args.Contains("--login"));
        });
        return 0;
    }

    static DispatcherQueue? Ui;
    static void Dispatch(Action a) => Ui?.TryEnqueue(() => a());
}
