import { Component, type ReactNode } from 'react';
import { LINKS, SITE } from '../../lib/landing';

// If something on the public pages throws, a visitor still gets a way in: the name and the two links that matter,
// instead of a blank screen. (Nothing above this component catches errors: the public pages have no app around them.)

export default class LandingErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('The public page failed:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-page px-6 text-center text-ink">
        <h1 className="m-0 text-3xl font-semibold">{SITE.name}</h1>
        <p className="m-0 max-w-md text-[15px] text-muted-foreground">Something went wrong loading this page. You can still sign in or create your company.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <a href={LINKS.signIn} className="rounded-tile border border-border bg-white px-5 py-3 text-[14px] font-semibold text-ink">
            Sign in
          </a>
          <a href={LINKS.create} className="rounded-tile bg-brand px-5 py-3 text-[14px] font-semibold text-white">
            Create your company
          </a>
        </div>
      </div>
    );
  }
}
