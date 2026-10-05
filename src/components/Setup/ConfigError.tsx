interface ConfigErrorProps {
  missing: string[];
}

/** Shown instead of a blank page when the site was built without its required settings. */
export default function ConfigError({ missing }: ConfigErrorProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div role="alert" className="max-w-lg w-full bg-white border border-border rounded-card p-6">
        <h1 className="m-0 text-lg font-bold text-ink">Figbloom HR is not set up yet</h1>
        <p className="mt-2 mb-3 text-sm text-muted-foreground">
          This copy of the site was built without these settings, so it cannot connect to its database:
        </p>
        <ul className="m-0 mb-4 pl-5 text-sm font-mono text-ink">
          {missing.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="m-0 text-sm text-muted-foreground">
          Add them in your hosting settings (on Vercel: Project, then Settings, then Environment Variables), then redeploy.
          The settings are read when the site is built, so adding them does not change a deployment that already exists.
        </p>
      </div>
    </div>
  );
}
