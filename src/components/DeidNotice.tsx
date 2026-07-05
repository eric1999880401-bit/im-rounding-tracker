// Fixed de-identification reminder shown next to AI generate actions. Replaces
// the old per-panel confirmation checkbox: the reminder is always visible and
// generation is not gated on a click. The callable still asserts the
// de-identified contract to the backend.
// span2 must stay opt-in: "span 2" inside a grid with no declared columns
// forces an implicit second column and scatters every sibling across it.
export default function DeidNotice({ span2 = false }: { span2?: boolean }) {
  return (
    <p className={span2 ? "deid-notice span-2" : "deid-notice"}>
      ⚠ De-identify before pasting — no name, MRN, birthday, phone, address, or ID.
    </p>
  );
}
