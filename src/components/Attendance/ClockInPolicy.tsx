import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { MapPin } from 'lucide-react';
import { Button, Card } from '../UI';
import { inputClass, labelClass } from '../Perfomance/kpis/shared';
import { CLOCK_IN_POLICY_LABEL, parseNetworks, type ClockInPolicy as Policy } from '../../lib/attendance';
import {
  currentLocation,
  loadBranchLocations,
  loadClockInSettings,
  loadScannerAddresses,
  saveBranchLocation,
  saveClockInSettings,
  type BranchLocation,
  type ClockInSettings,
} from '../../lib/attendanceApi';

const POLICY_HINT: Record<Policy, string> = {
  anywhere: 'Staff can clock in in the app from anywhere.',
  office: 'Staff clock in in the app only on an office network, or near a branch (using the location their phone sends).',
  scanner_only: "The app's Clock in is refused: staff clock in at the office scanner.",
};

/**
 * Where staff may clock in from in the app (migration 20261024100000): anywhere, only from an office (its networks or
 * near a branch), or the scanner only. Remote, field and hybrid people (on their remote days) clock in from anywhere
 * whatever this says: that is set on each person's profile (Work arrangement).
 */
export default function ClockInPolicy() {
  const [saved, setSaved] = useState<ClockInSettings | null>(null);
  const [policy, setPolicy] = useState<Policy>('anywhere');
  const [networks, setNetworks] = useState('');
  const [radius, setRadius] = useState('300');
  const [suggested, setSuggested] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([loadClockInSettings(), loadScannerAddresses().catch(() => [] as string[])])
      .then(([s, scanners]) => {
        if (!live) return;
        setSaved(s);
        setPolicy(s.policy);
        setRadius(String(s.radiusM));
        // nothing listed yet: start from the addresses the company's scanners call from
        if (s.networks.length === 0 && scanners.length > 0) {
          setNetworks(scanners.join('\n'));
          setSuggested(true);
        } else {
          setNetworks(s.networks.join('\n'));
        }
      })
      .catch((e) => live && setProblem((e as Error).message));
    return () => {
      live = false;
    };
  }, []);

  if (!saved) return problem ? <p role="alert" className="text-[12px] text-status-danger">{problem}</p> : null;

  const save = async () => {
    const r = Number(radius);
    if (!Number.isInteger(r) || r < 25 || r > 5000) return setProblem('Choose a distance from 25 to 5000 metres');
    setProblem(null);
    setBusy(true);
    try {
      const s = await saveClockInSettings({ policy, networks: parseNetworks(networks), radiusM: r });
      setSaved(s);
      setNetworks(s.networks.join('\n'));
      setSuggested(false);
      toast.success('Clock-in policy saved');
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="sm" className="space-y-3" aria-label="Clock-in policy">
      <div>
        <div className="text-[13px] font-semibold text-ink">Where staff can clock in from in the app</div>
        <div className="text-[11.5px] text-muted-foreground">
          Remote, field and hybrid staff (on their remote days) can clock in from anywhere: set that on their profile (Work arrangement).
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="sr-only">Clock-in policy</legend>
        {(Object.keys(CLOCK_IN_POLICY_LABEL) as Policy[]).map((p) => (
          <label key={p} className="flex items-start gap-2 text-[13px] cursor-pointer">
            <input type="radio" name="clock-in-policy" value={p} checked={policy === p} onChange={() => setPolicy(p)} className="mt-1" />
            <span>
              <span className="font-semibold text-ink">{CLOCK_IN_POLICY_LABEL[p]}</span>
              <span className="block text-[11.5px] text-muted-foreground">{POLICY_HINT[p]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {policy === 'office' && (
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
          <div className="min-w-0">
            <label htmlFor="office-networks" className={labelClass}>Office networks (public IP addresses or ranges, one per line)</label>
            <textarea id="office-networks" rows={3} className={inputClass} value={networks} onChange={(e) => setNetworks(e.target.value)}
              placeholder={'41.90.12.7\n41.90.12.0/24'} />
            <p className="text-[11.5px] text-muted-foreground mt-1">
              {suggested ? 'Filled in from the addresses your scanners call from. Check them and save. ' : ''}
              Someone on one of these networks can clock in without sharing their location.
            </p>
          </div>
          <div className="min-w-0">
            <label htmlFor="office-radius" className={labelClass}>Or within (metres) of a branch</label>
            <input id="office-radius" type="number" min={25} max={5000} className={inputClass} value={radius} onChange={(e) => setRadius(e.target.value)} />
          </div>
        </div>
      )}

      {problem && <p role="alert" className="text-[12px] text-status-danger">{problem}</p>}
      <div className="flex justify-end">
        <Button disabled={busy} onClick={() => void save()}>Save</Button>
      </div>

      {policy === 'office' && <BranchLocations />}
    </Card>
  );
}

/** Where each branch is, for "near a branch": typed in, or the phone's own location while standing there. */
export function BranchLocations() {
  const [branches, setBranches] = useState<BranchLocation[] | null>(null);

  useEffect(() => {
    let live = true;
    loadBranchLocations()
      .then((b) => live && setBranches(b.filter((x) => x.active)))
      .catch(() => live && setBranches([]));
    return () => {
      live = false;
    };
  }, []);

  if (!branches) return null;
  if (branches.length === 0) return <p className="text-[12px] text-muted-foreground">Add a branch to set where your office is.</p>;
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="text-[12px] font-semibold text-ink">Branch locations</div>
      {branches.map((b) => <BranchLocationRow key={b.id} branch={b} />)}
    </div>
  );
}

function BranchLocationRow({ branch }: { branch: BranchLocation }) {
  const [lat, setLat] = useState(branch.latitude === null ? '' : String(branch.latitude));
  const [lon, setLon] = useState(branch.longitude === null ? '' : String(branch.longitude));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `branch-${branch.id}`;

  const here = async () => {
    setBusy(true);
    const loc = await currentLocation();
    setBusy(false);
    if (!loc) return setProblem('Your location is off or unavailable: allow it, or type the coordinates');
    setProblem(null);
    setLat(loc.latitude.toFixed(6));
    setLon(loc.longitude.toFixed(6));
  };

  const save = async () => {
    const both = lat.trim() !== '' && lon.trim() !== '';
    if (!both && (lat.trim() !== '' || lon.trim() !== '')) return setProblem('Enter both the latitude and the longitude, or neither');
    setBusy(true);
    setProblem(null);
    try {
      await saveBranchLocation(branch.id, both ? Number(lat) : null, both ? Number(lon) : null);
      toast.success(`${branch.name}'s location saved`);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end" aria-label={`${branch.name} location`}>
      <div className="text-[13px] font-semibold text-ink self-center">{branch.name}</div>
      <div className="min-w-0">
        <label htmlFor={`${id}-lat`} className={labelClass}>Latitude</label>
        <input id={`${id}-lat`} inputMode="decimal" className={inputClass} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-1.286389" />
      </div>
      <div className="min-w-0">
        <label htmlFor={`${id}-lon`} className={labelClass}>Longitude</label>
        <input id={`${id}-lon`} inputMode="decimal" className={inputClass} value={lon} onChange={(e) => setLon(e.target.value)} placeholder="36.817223" />
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={busy} icon={<MapPin size={12} />} onClick={() => void here()} aria-label={`Use my location for ${branch.name}`}>Here</Button>
        <Button disabled={busy} onClick={() => void save()} aria-label={`Save ${branch.name} location`}>Save</Button>
      </div>
      {problem && <p role="alert" className="sm:col-span-4 text-[12px] text-status-danger">{problem}</p>}
    </div>
  );
}
