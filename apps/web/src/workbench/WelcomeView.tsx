export function WelcomeView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 overflow-auto p-6 text-center">
      <h1 className="text-lg font-medium">Welcome to Awen</h1>
      <p className="text-sm text-muted-foreground">Open a Session from the Sidebar.</p>
    </div>
  );
}
