import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Printer } from 'lucide-react';
import { Button, Modal } from '../UI';
import { StaffIdCardBack, StaffIdCardFront } from './StaffIdCard';
import { useCardLook } from './useCardLook';
import { type StaffIdCardData, loadStaffIdCards } from '../../lib/staffIdCards';
import { SHEET, facesIn, printCards } from '../../lib/staffIdCardExport';

export interface PrintableEmployee {
  id: string;
  number: string;
  department: string;
}

type Who = 'selected' | 'department';

/**
 * Prints several staff ID cards at once (the 'staff-id-cards' module): the employees ticked on the list, or a whole
 * department. Nine cards to an A4 page, a page of fronts then a page of their backs (lib/staffIdCardExport.ts).
 */
export default function StaffIdCardsPrintDialog({
  open,
  onClose,
  employees,
  selectedNumbers,
}: {
  open: boolean;
  onClose: () => void;
  employees: PrintableEmployee[];
  selectedNumbers: string[];
}) {
  const { branding, settings } = useCardLook();
  const departments = useMemo(
    () => [...new Set(employees.map((e) => e.department.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [employees],
  );
  const [who, setWho] = useState<Who>(selectedNumbers.length ? 'selected' : 'department');
  const [department, setDepartment] = useState('');
  const [cards, setCards] = useState<StaffIdCardData[] | null>(null);
  const [busy, setBusy] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setWho(selectedNumbers.length ? 'selected' : 'department');
  }, [open, selectedNumbers.length]);

  const chosen = useMemo(() => {
    if (who === 'selected') {
      const wanted = new Set(selectedNumbers);
      return employees.filter((e) => wanted.has(e.number));
    }
    return department ? employees.filter((e) => e.department.trim() === department) : [];
  }, [who, department, employees, selectedNumbers]);

  const start = async () => {
    setBusy(true);
    try {
      const loaded = await loadStaffIdCards(chosen.map((e) => e.id).filter(Boolean));
      if (loaded.length === 0) throw new Error('None of these employees could be found.');
      setCards(loaded); // drawn off screen below, then printed
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  // once the cards are drawn: copy them out and print
  useEffect(() => {
    if (!cards || !sheet.current) return;
    let live = true;
    facesIn(sheet.current)
      .then((faces) => live && printCards(faces, who === 'department' ? `ID cards - ${department}` : 'Staff ID cards'))
      .catch((e) => toast.error((e as Error).message || 'The cards could not be printed.'))
      .finally(() => {
        if (!live) return;
        setCards(null);
        setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [cards, who, department]);

  // one card prints front and back on a single page
  const pages = chosen.length === 1 ? 1 : Math.ceil(chosen.length / (SHEET.cols * SHEET.rows)) * 2;
  return (
    <Modal open={open} onClose={onClose} title="Print ID cards" size="md" closeOnBackdrop={!busy}>
      <div className="space-y-4 text-[12.5px]">
        <fieldset className="space-y-2 border-0 p-0 m-0">
          <legend className="sr-only">Whose cards</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="who" checked={who === 'selected'} disabled={!selectedNumbers.length} onChange={() => setWho('selected')} />
            The employees ticked on the list ({selectedNumbers.length})
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="who" checked={who === 'department'} onChange={() => setWho('department')} />
            Everyone in a department
          </label>
          {who === 'department' && (
            <select
              aria-label="Department"
              className="w-full rounded-tile border border-border bg-white px-3 py-2"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">Choose a department…</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
        </fieldset>
        <p className="m-0 text-muted-foreground">
          {chosen.length
            ? `${chosen.length} card${chosen.length === 1 ? '' : 's'} on ${pages} A4 page${pages === 1 ? '' : 's'}: nine to a page, fronts then backs. Print both sides flipping on the long edge, or print the backs separately and stick them on, then cut along the dashed lines.`
            : 'Choose whose cards to print.'}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={start} disabled={busy || !chosen.length || !branding} icon={<Printer className="w-3.5 h-3.5" />}>
            {busy ? 'Preparing…' : 'Print'}
          </Button>
        </div>
      </div>
      {cards && branding && (
        <div ref={sheet} aria-hidden="true" style={{ position: 'fixed', left: '-10000px', top: 0, width: '600px' }}>
          {cards.map((c) => (
            <div key={c.employee_id}>
              <StaffIdCardFront card={c} branding={branding} settings={settings} />
              <StaffIdCardBack card={c} branding={branding} settings={settings} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
