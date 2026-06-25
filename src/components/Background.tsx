// Clean light backdrop for the TV — no image, just a soft glow + vignette.
export function Background() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[#f4f2ed]">
      <div
        className="absolute -top-1/3 left-1/2 h-[80vh] w-[80vh] -translate-x-1/2 rounded-full blur-[160px]"
        style={{
          background:
            "radial-gradient(circle, rgba(255,255,255,0.65), transparent 60%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.04) 100%)",
        }}
      />
    </div>
  );
}
