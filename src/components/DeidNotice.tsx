// Fixed de-identification reminder shown next to AI generate actions. Replaces
// the old per-panel confirmation checkbox: the reminder is always visible and
// generation is not gated on a click. The callable still asserts the
// de-identified contract to the backend.
export default function DeidNotice() {
  return (
    <p className="deid-notice span-2">
      ⚠ De-identify before pasting — no name, MRN, birthday, phone, address, or ID.
    </p>
  );
}
