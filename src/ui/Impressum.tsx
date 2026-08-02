import { IconBack } from './Icons';

/* § 5 DDG (formerly § 5 TMG). The address is a placeholder — Jan is routing
   this through a c/o mail-forwarding service to keep his private address
   off the public record, and hasn't picked one yet. This screen is not
   legally complete until [ANSCHRIFT] is replaced with a real, loadable
   address. Name and email are real. */

export function Impressum({ onClose }: { onClose: () => void }) {
  return (
    <div className="scroller">
      <div className="wrap">
        <button className="btn ghost" onClick={onClose} style={{ marginBottom: 'var(--s4)' }}>
          <IconBack size={16} />
          Back
        </button>

        <div className="eyebrow">Impressum</div>
        <h1 className="display">Angaben gemäß § 5 DDG</h1>

        <div className="panel">
          <p>
            Jan Doerkes
            <br />
            [ANSCHRIFT — Straße, Hausnummer]
            <br />
            [PLZ Ort]
          </p>
        </div>

        <div className="panel">
          <h3>Kontakt</h3>
          <p>E-Mail: jandoerkes@gmail.com</p>
        </div>

        <div className="panel">
          <h3>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h3>
          <p>
            Jan Doerkes
            <br />
            [ANSCHRIFT — wie oben]
          </p>
        </div>

        <p className="hint" style={{ marginTop: 'var(--s4)' }}>
          Soluna ist ein privates, nicht-kommerzielles Projekt.
        </p>
      </div>
    </div>
  );
}
