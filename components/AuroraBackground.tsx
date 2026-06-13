// Animated ambient background used across premium app pages.
// Pure decoration: fixed, non-interactive, sits behind page content (z-0).
export default function AuroraBackground() {
  return (
    <div className="aurora-bg" aria-hidden="true">
      <div className="aurora-stars--far" />
      <div className="aurora-stars" />
      <div className="aurora-sweep" />
      <div className="aurora-orb aurora-orb--cyan" />
      <div className="aurora-orb aurora-orb--violet" />
      <div className="aurora-orb aurora-orb--pink" />
      <div className="aurora-comet" />
      <div className="aurora-grid" />
      <div className="aurora-vignette" />
    </div>
  );
}
