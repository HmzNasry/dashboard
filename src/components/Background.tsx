// TV backdrop: a softly-blurred floral photo (flowers framing the edges) under
// a warm cream wash so the dark schedule text and white cards stay readable.
// Swap the image by replacing public/bg.jpg.
export function Background() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[#f4f2ed]">
      {/* Blurred photo. Scaled up so the blur doesn't reveal soft edges. */}
      <div
        className="absolute inset-0 scale-110 bg-cover bg-center blur-[7px]"
        style={{ backgroundImage: "url(/bg.jpg)" }}
      />
      {/* Flat, even cream wash for contrast — no gradients, so nothing reads as
          a faint "container" outline behind the cards. */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(244,242,237,0.5)" }}
      />
    </div>
  );
}
