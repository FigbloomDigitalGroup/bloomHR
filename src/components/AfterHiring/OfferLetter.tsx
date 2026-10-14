import { forwardRef } from 'react';
import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '../../lib/companyProfile';
import { letterDate, type LetterBranding } from '../../lib/offers';

// An offer letter as the candidate sees it: the company's letterhead (logo, name, address, colours from the company
// profile), the date, the title and the filled-in text. The same element is turned into the PDF, so it keeps to plain
// colours and fixed sizes.

interface OfferLetterProps {
  branding: LetterBranding;
  title: string;
  /** the letter's text with the placeholders already filled */
  text: string;
  /** the letter's date (when it was sent; today for a draft) */
  date?: string | null;
}

const hex = (c: string | null | undefined, fallback: string) => (c && /^#[0-9A-Fa-f]{6}$/.test(c) ? c : fallback);

const OfferLetter = forwardRef<HTMLDivElement, OfferLetterProps>(function OfferLetter({ branding, title, text, date }, ref) {
  const primary = hex(branding.primary_color, DEFAULT_PRIMARY_COLOR);
  const secondary = hex(branding.secondary_color, DEFAULT_SECONDARY_COLOR);
  const address = [branding.address_line1, branding.address_line2, [branding.city, branding.postal_code].filter(Boolean).join(' '), branding.country]
    .filter((s) => s && String(s).trim())
    .join(', ');
  const contact = [branding.phone, branding.email, branding.website].filter(Boolean).join(' · ');
  // a blank line starts a paragraph; a single line break stays a line break
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <div ref={ref} className="bg-white text-[#1f2937] w-full max-w-[760px] mx-auto shadow-sm border border-[#e5e7eb]" data-testid="offer-letter">
      <div style={{ height: 6, background: primary }} />
      <div className="px-6 sm:px-10 pt-6 pb-4 flex flex-wrap items-start justify-between gap-4" style={{ borderBottom: `2px solid ${secondary}` }}>
        <div className="flex items-center gap-3 min-w-0">
          {branding.logo_url && (
            <img src={branding.logo_url} alt={`${branding.name} logo`} crossOrigin="anonymous" className="h-14 w-auto max-w-[140px] object-contain" />
          )}
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight" style={{ color: primary }}>{branding.name}</p>
            {branding.tagline && <p className="text-xs text-[#6b7280]">{branding.tagline}</p>}
          </div>
        </div>
        <div className="text-right text-[11px] leading-relaxed text-[#6b7280] max-w-[260px]">
          {address && <p>{address}</p>}
          {contact && <p>{contact}</p>}
        </div>
      </div>
      <div className="px-6 sm:px-10 py-8 text-[14px] leading-relaxed">
        <p className="text-right text-[13px] text-[#6b7280] mb-6">{letterDate(date ?? new Date().toISOString())}</p>
        <h1 className="text-[17px] font-bold mb-5" style={{ color: primary }}>{title}</h1>
        {paragraphs.map((p, i) => (
          <p key={i} className="mb-4 whitespace-pre-line">{p}</p>
        ))}
      </div>
      <div style={{ height: 4, background: secondary }} />
    </div>
  );
});

export default OfferLetter;
