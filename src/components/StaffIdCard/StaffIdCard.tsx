import { useEffect, useId, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { code128Bars } from '../../lib/code128';
import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '../../lib/companyProfile';
import type { LetterBranding } from '../../lib/offers';
import { companyAddress, wrapText } from './cardText';
import {
  type CardLayout,
  type StaffIdCardData,
  type StaffIdCardSettings,
  cardDate,
  cardExpiry,
  formatCardDate,
  forLayout,
  framingOf,
  fullName,
  initials,
  nameParts,
  placePhoto,
  verifyUrl,
} from '../../lib/staffIdCards';

// The staff ID card (a "job card", migration 20261027400000): CR80, front and back, in the company's colours, portrait
// (54 x 85.6 mm) or landscape (85.6 x 54 mm); every card is shown both ways, each with its own photo framing
// (migration 20261118300000). Each face is one SVG drawn at 10 units per millimetre, so the same drawing is sharp on a phone,
// in the PNG and PDF downloads (lib/staffIdCardExport.ts turns it into an image) and printed at its true size.
// SVG rather than HTML because the hexagon photo and the angled colour panels need clipping that html2canvas can't
// draw, and because a whole face as one image can be scaled to millimetres without anything reflowing.

export const CARD_W = 540;
export const CARD_H = 856;
/** the landscape card, the same card turned on its side */
export const LANDSCAPE_W = CARD_H;
export const LANDSCAPE_H = CARD_W;
const DARK = '#14171C';
const INK = '#1F2328';
const MUTED = '#6B7280';
const FONT = "'Geist Sans', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface CardFaceProps {
  card: StaffIdCardData;
  branding: LetterBranding;
  settings: StaffIdCardSettings;
  /** where the QR code points (the app's address); defaults to this page's */
  origin?: string;
  /** portrait (the default) or landscape */
  layout?: CardLayout;
  /** width on screen (any CSS length); the height follows */
  width?: string;
  className?: string;
}

const colours = (b: LetterBranding) => ({
  primary: b.primary_color || DEFAULT_PRIMARY_COLOR,
  secondary: b.secondary_color || DEFAULT_SECONDARY_COLOR,
});

/** Shortens text to about `max` characters, with an ellipsis. */
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text);

/** A font size that fits about `chars` characters in `width` units (sans-serif averages ~0.55 em a character). */
const fit = (chars: number, width: number, max: number, min = 14) => Math.max(min, Math.min(max, width / (Math.max(chars, 1) * 0.56)));

/** A pointy-topped hexagon's corners around (cx, cy). */
export const hexagon = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

/** A photo's own size once it has loaded (null until then, or when it can't be loaded), to place it in the hexagon. */
export function useImageSize(url: string | null): { w: number; h: number } | null {
  const [size, setSize] = useState<{ url: string; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && img.naturalWidth > 0 && setSize({ url, w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return size && size.url === url ? { w: size.w, h: size.h } : null;
}

/** An id usable inside url(#...) (React's ids contain colons). */
const useSvgId = (prefix: string) => `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

function Svg({
  label, width, className, children, w = CARD_W, h = CARD_H,
}: { label: string; width?: string; className?: string; children: React.ReactNode; w?: number; h?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      viewBox={`0 0 ${w} ${h}`}
      width={width ?? '100%'}
      role="img"
      aria-label={label}
      className={className}
      style={{ display: 'block', aspectRatio: `${w} / ${h}`, height: 'auto', fontFamily: FONT }}
      data-card-face=""
    >
      {children}
    </svg>
  );
}

/** The company's logo in a white rounded tile, or its first letter when it has none. */
function Logo({ branding, x, y, size, clipId }: { branding: LetterBranding; x: number; y: number; size: number; clipId: string }) {
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={size * 0.2} fill="#FFFFFF" />
      {branding.logo_url ? (
        <>
          <clipPath id={clipId}>
            <rect x={x + 4} y={y + 4} width={size - 8} height={size - 8} rx={size * 0.16} />
          </clipPath>
          <image
            href={branding.logo_url}
            x={x + 4} y={y + 4} width={size - 8} height={size - 8}
            preserveAspectRatio="xMidYMid meet"
            clipPath={`url(#${clipId})`}
            crossOrigin="anonymous"
            data-card-image="logo"
          />
        </>
      ) : (
        <text x={x + size / 2} y={y + size * 0.68} textAnchor="middle" fontSize={size * 0.5} fontWeight={800} fill={colours(branding).primary}>
          {(branding.name || '?').trim().charAt(0).toUpperCase()}
        </text>
      )}
    </g>
  );
}

function PortraitFront({ card, branding, settings, width, className }: CardFaceProps) {
  const { primary, secondary } = colours(branding);
  const photoClip = useSvgId('photo');
  const logoClip = useSvgId('logo');
  const { first, rest } = nameParts(card);
  const name = [first, rest].filter(Boolean).join(' ');
  // a long name goes on two lines: the first name, then the rest
  const twoLines = name.length > 20 && !!first && !!rest;
  const nameSize = twoLines ? fit(Math.max(first.length, rest.length), 470, 40) : fit(name.length, 470, 42);
  const company = clip(branding.name || '', 26);
  const title = card.job_title ? clip(card.job_title.toUpperCase(), 34) : '';
  const facts: [string, string][] = [
    ['ID NO', card.employee_number],
    ['DEPARTMENT', card.department ?? ''],
    ['PHONE', card.work_phone ?? ''],
    ['EMAIL', card.work_email ?? ''],
    ...(settings.show_date_of_birth && card.date_of_birth ? [['DOB', cardDate(card.date_of_birth)] as [string, string]] : []),
  ].filter(([, v]) => v) as [string, string][];
  const factsTop = twoLines ? 640 : 615;
  const barcode = code128Bars(card.employee_number);
  const unit = Math.min(3, 380 / barcode.width);
  const barX = (CARD_W - barcode.width * unit) / 2;
  const hexR = 118;
  const hexY = 318;
  // the photo covers the hexagon's square, moved and zoomed as framed (Adjust photo)
  const photoSize = useImageSize(card.photo_url);
  const photo = placePhoto(photoSize, framingOf(card), CARD_W / 2, hexY, hexR * 2);

  return (
    <Svg label={`Staff ID card of ${fullName(card)}, front`} width={width} className={className}>
      <rect width={CARD_W} height={CARD_H} fill="#FFFFFF" />
      {/* the dark band with its angled edge, and the colour panels under it */}
      <polygon points={`0,0 ${CARD_W},0 ${CARD_W},215 0,300`} fill={DARK} />
      <polygon points={`0,300 ${CARD_W},215 ${CARD_W},255 0,340`} fill={primary} />
      <polygon points={`0,340 ${CARD_W * 0.5},297.5 ${CARD_W * 0.5},309.5 0,352`} fill={secondary} />
      <polygon points={`${CARD_W * 0.62},0 ${CARD_W},0 ${CARD_W},160`} fill={primary} opacity={0.35} />
      <polygon points={`${CARD_W * 0.8},0 ${CARD_W},0 ${CARD_W},70`} fill={secondary} opacity={0.8} />

      <Logo branding={branding} x={36} y={34} size={78} clipId={logoClip} />
      <text x={130} y={branding.tagline ? 70 : 82} fontSize={fit(company.length, 280, 30, 18)} fontWeight={800} fill="#FFFFFF">
        {company}
      </text>
      {branding.tagline && (
        <text x={130} y={100} fontSize={17} fill="#FFFFFF" opacity={0.75}>{clip(branding.tagline, 32)}</text>
      )}

      {/* the photo in a hexagon, initials when there is none (the photo covers them when it loads) */}
      <polygon points={hexagon(CARD_W / 2, hexY, hexR + 14)} fill={primary} />
      <polygon points={hexagon(CARD_W / 2, hexY, hexR + 6)} fill="#FFFFFF" />
      <polygon points={hexagon(CARD_W / 2, hexY, hexR)} fill="#E8ECEF" />
      <text x={CARD_W / 2} y={hexY + 30} textAnchor="middle" fontSize={84} fontWeight={800} fill={primary}>{initials(card)}</text>
      {card.photo_url && (
        <>
          <clipPath id={photoClip}>
            <polygon points={hexagon(CARD_W / 2, hexY, hexR)} />
          </clipPath>
          <image
            href={card.photo_url}
            x={photo.x} y={photo.y} width={photo.width} height={photo.height}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${photoClip})`}
            crossOrigin="anonymous"
            data-card-image="photo"
          />
        </>
      )}

      {/* the name, first name bold */}
      {twoLines ? (
        <text x={CARD_W / 2} y={505} textAnchor="middle" fontSize={nameSize} fill={INK}>
          <tspan x={CARD_W / 2} fontWeight={800}>{first}</tspan>
          <tspan x={CARD_W / 2} dy={nameSize * 1.1} fontWeight={400}>{rest}</tspan>
        </text>
      ) : (
        <text x={CARD_W / 2} y={515} textAnchor="middle" fontSize={nameSize} fill={INK}>
          <tspan fontWeight={800}>{first}</tspan>
          {rest && <tspan fontWeight={400}>{first ? ` ${rest}` : rest}</tspan>}
        </text>
      )}
      {title && (
        <text x={CARD_W / 2} y={twoLines ? 578 : 553} textAnchor="middle" fontSize={fit(title.length, 440, 20, 13)} fontWeight={600} letterSpacing={1.5} fill={MUTED}>
          {title}
        </text>
      )}
      <line x1={CARD_W / 2 - 110} x2={CARD_W / 2 + 110} y1={twoLines ? 596 : 571} y2={twoLines ? 596 : 571} stroke={primary} strokeWidth={2} />

      {/* the details, two columns */}
      {facts.map(([label, value], i) => (
        <g key={label}>
          <text x={62} y={factsTop + i * 31} fontSize={15} fontWeight={700} letterSpacing={0.8} fill={MUTED}>{label}</text>
          <text x={192} y={factsTop + i * 31} fontSize={16.5} fontWeight={label === 'ID NO' ? 700 : 500} fill={INK}>
            {`: ${clip(value, 32)}`}
          </text>
        </g>
      ))}

      {/* the employee number as a barcode */}
      <g transform={`translate(${barX}, 776)`} data-barcode={card.employee_number}>
        {barcode.bars.map((b, i) => (
          <rect key={i} x={b.x * unit} y={0} width={b.w * unit} height={48} fill={INK} />
        ))}
      </g>
      <rect x={0} y={CARD_H - 14} width={CARD_W} height={14} fill={primary} />
      <rect x={CARD_W * 0.7} y={CARD_H - 14} width={CARD_W * 0.3} height={14} fill={secondary} />
    </Svg>
  );
}

function PortraitBack({ card, branding, settings, origin, width, className }: CardFaceProps) {
  const { primary, secondary } = colours(branding);
  const logoClip = useSvgId('logo');
  const company = branding.name || 'the company';
  const address = companyAddress(branding);
  const terms = [
    `This card is the property of ${company} and must be returned on leaving.`,
    'Carry it at all times at work and show it when asked.',
    `If found, please return to ${company}${address ? `, ${address}` : ''}.`,
  ];
  const termLines = terms.map((t) => wrapText(t, 46).slice(0, 3));
  let y = 92;
  const expiry = cardExpiry(card);
  const contact = [
    address && clip(address, 50),
    branding.phone && `Tel: ${branding.phone}`,
    branding.email && clip(branding.email, 44),
  ].filter(Boolean) as string[];

  return (
    <Svg label={`Staff ID card of ${fullName(card)}, back`} width={width} className={className}>
      <rect width={CARD_W} height={CARD_H} fill="#FFFFFF" />
      <polygon points={`0,0 ${CARD_W},0 ${CARD_W},330 0,400`} fill={DARK} />
      <polygon points={`0,400 ${CARD_W},330 ${CARD_W},360 0,430`} fill={primary} />
      <polygon points={`0,0 ${CARD_W * 0.3},0 0,120`} fill={primary} opacity={0.4} />
      <polygon points={`0,0 ${CARD_W * 0.14},0 0,52`} fill={secondary} opacity={0.85} />

      <text x={46} y={y - 32} fontSize={15} fontWeight={700} letterSpacing={2} fill={secondary}>STAFF ID CARD</text>
      {termLines.map((lines, i) => {
        const top = y;
        y += lines.length * 24 + 14;
        return (
          <g key={i}>
            <circle cx={52} cy={top - 6} r={4.5} fill={secondary} />
            <text x={68} y={top} fontSize={17} fill="#FFFFFF">
              {lines.map((line, j) => (
                <tspan key={j} x={68} dy={j === 0 ? 0 : 24}>{line}</tspan>
              ))}
            </text>
          </g>
        );
      })}
      <text x={46} y={Math.max(y + 12, 290)} fontSize={18} fill="#FFFFFF">
        <tspan fontWeight={700}>Joined Date: </tspan>
        <tspan>{cardDate(card.date_joined) || '—'}</tspan>
      </text>
      <text x={46} y={Math.max(y + 42, 320)} fontSize={18} fill="#FFFFFF">
        <tspan fontWeight={700}>Expiry Date: </tspan>
        <tspan>{formatCardDate(expiry) || '—'}</tspan>
      </text>

      {/* the authorised signatory */}
      {settings.signature && (
        <image href={settings.signature} x={40} y={472} width={230} height={86} preserveAspectRatio="xMidYMid meet" />
      )}
      <line x1={40} x2={270} y1={566} y2={566} stroke={INK} strokeWidth={1.5} />
      <text x={40} y={592} fontSize={17} fontWeight={700} fill={INK}>{clip(settings.signatory_name || 'Authorised signatory', 26)}</text>
      {settings.signatory_name && (
        <text x={40} y={615} fontSize={15} fill={MUTED}>{clip(settings.signatory_title || 'Authorised signatory', 28)}</text>
      )}

      {/* the QR code: opens the public check that says whether the person is a current employee */}
      <rect x={316} y={452} width={190} height={190} rx={12} fill="#FFFFFF" stroke="#E5E7EB" strokeWidth={2} />
      <QRCodeSVG value={verifyUrl(card.token, origin)} x={326} y={462} size={170} level="M" fgColor={INK} bgColor="#FFFFFF" />
      <text x={411} y={664} textAnchor="middle" fontSize={14} fontWeight={600} fill={MUTED}>Scan to verify</text>

      {/* the company's contacts */}
      <line x1={36} x2={CARD_W - 36} y1={690} y2={690} stroke="#E5E7EB" strokeWidth={2} />
      <Logo branding={branding} x={36} y={712} size={64} clipId={logoClip} />
      <text x={114} y={736} fontSize={fit(clip(company, 30).length, 380, 20, 14)} fontWeight={800} fill={INK}>{clip(company, 30)}</text>
      {contact.map((line, i) => (
        <text key={i} x={114} y={760 + i * 21} fontSize={14} fill={MUTED}>{line}</text>
      ))}
      <rect x={0} y={CARD_H - 14} width={CARD_W} height={14} fill={primary} />
      <rect x={0} y={CARD_H - 14} width={CARD_W * 0.3} height={14} fill={secondary} />
    </Svg>
  );
}

/** The details on the front, label and value (the date of birth only when the company shows it). */
const frontFacts = (card: StaffIdCardData, settings: StaffIdCardSettings) =>
  ([
    ['ID NO', card.employee_number],
    ['DEPARTMENT', card.department ?? ''],
    ['PHONE', card.work_phone ?? ''],
    ['EMAIL', card.work_email ?? ''],
    ...(settings.show_date_of_birth && card.date_of_birth ? [['DOB', cardDate(card.date_of_birth)] as [string, string]] : []),
  ] as [string, string][]).filter(([, v]) => v);

/** Landscape front: the photo and company on a dark panel at the left, the name and details on the right. */
function LandscapeFront({ card, branding, settings, width, className }: CardFaceProps) {
  const W = LANDSCAPE_W;
  const H = LANDSCAPE_H;
  const { primary, secondary } = colours(branding);
  const photoClip = useSvgId('photo');
  const logoClip = useSvgId('logo');
  const { first, rest } = nameParts(card);
  const name = [first, rest].filter(Boolean).join(' ');
  // a long name goes on two lines: the first name, then the rest
  const twoLines = name.length > 20 && !!first && !!rest;
  const nameSize = twoLines ? fit(Math.max(first.length, rest.length), 466, 38) : fit(name.length, 466, 40);
  const company = clip(branding.name || '', 22);
  const title = card.job_title ? clip(card.job_title.toUpperCase(), 34) : '';
  const facts = frontFacts(card, settings);
  const left = 360;
  const nameY = twoLines ? 96 : 110;
  const titleY = twoLines ? 182 : 150;
  const factsTop = titleY + 58;
  const barcode = code128Bars(card.employee_number);
  const unit = Math.min(3, 440 / barcode.width);
  const hexR = 100;
  const hexX = 140;
  const hexY = 250;
  // the photo covers the hexagon's square, moved and zoomed as framed (Adjust photo)
  const photoSize = useImageSize(card.photo_url);
  const photo = placePhoto(photoSize, framingOf(card), hexX, hexY, hexR * 2);

  return (
    <Svg label={`Staff ID card of ${fullName(card)}, front`} width={width} className={className} w={W} h={H}>
      <rect width={W} height={H} fill="#FFFFFF" />
      {/* the dark panel with its angled edge, and the colour strips beside it */}
      <polygon points={`0,0 300,0 250,${H} 0,${H}`} fill={DARK} />
      <polygon points={`300,0 330,0 280,${H} 250,${H}`} fill={primary} />
      <polygon points={`330,0 340,0 315,${H * 0.5} 305,${H * 0.5}`} fill={secondary} />
      <polygon points={`${W * 0.78},0 ${W},0 ${W},110`} fill={primary} opacity={0.35} />
      <polygon points={`${W * 0.9},0 ${W},0 ${W},48`} fill={secondary} opacity={0.8} />

      <Logo branding={branding} x={30} y={28} size={64} clipId={logoClip} />

      {/* the photo in a hexagon, initials when there is none (the photo covers them when it loads) */}
      <polygon points={hexagon(hexX, hexY, hexR + 14)} fill={primary} />
      <polygon points={hexagon(hexX, hexY, hexR + 6)} fill="#FFFFFF" />
      <polygon points={hexagon(hexX, hexY, hexR)} fill="#E8ECEF" />
      <text x={hexX} y={hexY + 26} textAnchor="middle" fontSize={72} fontWeight={800} fill={primary}>{initials(card)}</text>
      {card.photo_url && (
        <>
          <clipPath id={photoClip}>
            <polygon points={hexagon(hexX, hexY, hexR)} />
          </clipPath>
          <image
            href={card.photo_url}
            x={photo.x} y={photo.y} width={photo.width} height={photo.height}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${photoClip})`}
            crossOrigin="anonymous"
            data-card-image="photo"
          />
        </>
      )}

      <text x={hexX - 5} y={branding.tagline ? 418 : 430} textAnchor="middle" fontSize={fit(company.length, 220, 26, 14)} fontWeight={800} fill="#FFFFFF">
        {company}
      </text>
      {branding.tagline && (
        <text x={hexX - 5} y={446} textAnchor="middle" fontSize={14} fill="#FFFFFF" opacity={0.75}>{clip(branding.tagline, 26)}</text>
      )}

      {/* the name, first name bold */}
      {twoLines ? (
        <text x={left} y={nameY} fontSize={nameSize} fill={INK}>
          <tspan x={left} fontWeight={800}>{first}</tspan>
          <tspan x={left} dy={nameSize * 1.1} fontWeight={400}>{rest}</tspan>
        </text>
      ) : (
        <text x={left} y={nameY} fontSize={nameSize} fill={INK}>
          <tspan fontWeight={800}>{first}</tspan>
          {rest && <tspan fontWeight={400}>{first ? ` ${rest}` : rest}</tspan>}
        </text>
      )}
      {title && (
        <text x={left} y={titleY} fontSize={fit(title.length, 460, 19, 13)} fontWeight={600} letterSpacing={1.5} fill={MUTED}>
          {title}
        </text>
      )}
      <line x1={left} x2={left + 200} y1={titleY + 20} y2={titleY + 20} stroke={primary} strokeWidth={2} />

      {/* the details */}
      {facts.map(([label, value], i) => (
        <g key={label}>
          <text x={left} y={factsTop + i * 31} fontSize={15} fontWeight={700} letterSpacing={0.8} fill={MUTED}>{label}</text>
          <text x={left + 128} y={factsTop + i * 31} fontSize={16.5} fontWeight={label === 'ID NO' ? 700 : 500} fill={INK}>
            {`: ${clip(value, 34)}`}
          </text>
        </g>
      ))}

      {/* the employee number as a barcode */}
      <g transform={`translate(${left}, 452)`} data-barcode={card.employee_number}>
        {barcode.bars.map((b, i) => (
          <rect key={i} x={b.x * unit} y={0} width={b.w * unit} height={48} fill={INK} />
        ))}
      </g>
      <rect x={0} y={H - 14} width={W} height={14} fill={primary} />
      <rect x={W * 0.7} y={H - 14} width={W * 0.3} height={14} fill={secondary} />
    </Svg>
  );
}

/** Landscape back: the terms on a dark band, then the signatory, the dates, the QR code and the company's contacts. */
function LandscapeBack({ card, branding, settings, origin, width, className }: CardFaceProps) {
  const W = LANDSCAPE_W;
  const H = LANDSCAPE_H;
  const { primary, secondary } = colours(branding);
  const logoClip = useSvgId('logo');
  const company = branding.name || 'the company';
  const address = companyAddress(branding);
  const terms = [
    `This card is the property of ${company} and must be returned on leaving.`,
    'Carry it at all times at work and show it when asked.',
    `If found, please return to ${company}${address ? `, ${address}` : ''}.`,
  ];
  const termLines = terms.map((t) => wrapText(t, 88).slice(0, 2));
  let y = 92;
  const expiry = cardExpiry(card);
  // the address is already in the terms ("If found, please return to")
  const contact = [branding.phone && `Tel: ${branding.phone}`, branding.email].filter(Boolean).join('  ·  ');

  return (
    <Svg label={`Staff ID card of ${fullName(card)}, back`} width={width} className={className} w={W} h={H}>
      <rect width={W} height={H} fill="#FFFFFF" />
      <polygon points={`0,0 ${W},0 ${W},215 0,250`} fill={DARK} />
      <polygon points={`0,250 ${W},215 ${W},235 0,270`} fill={primary} />
      <polygon points={`0,0 ${W * 0.2},0 0,110`} fill={primary} opacity={0.4} />
      <polygon points={`0,0 ${W * 0.09},0 0,48`} fill={secondary} opacity={0.85} />

      <text x={46} y={y - 36} fontSize={15} fontWeight={700} letterSpacing={2} fill={secondary}>STAFF ID CARD</text>
      {termLines.map((lines, i) => {
        const top = y;
        y += lines.length * 23 + 12;
        return (
          <g key={i}>
            <circle cx={52} cy={top - 6} r={4.5} fill={secondary} />
            <text x={68} y={top} fontSize={16.5} fill="#FFFFFF">
              {lines.map((line, j) => (
                <tspan key={j} x={68} dy={j === 0 ? 0 : 23}>{line}</tspan>
              ))}
            </text>
          </g>
        );
      })}

      {/* the authorised signatory */}
      {settings.signature && (
        <image href={settings.signature} x={40} y={290} width={230} height={80} preserveAspectRatio="xMidYMid meet" />
      )}
      <line x1={40} x2={270} y1={378} y2={378} stroke={INK} strokeWidth={1.5} />
      <text x={40} y={402} fontSize={17} fontWeight={700} fill={INK}>{clip(settings.signatory_name || 'Authorised signatory', 26)}</text>
      {settings.signatory_name && (
        <text x={40} y={424} fontSize={15} fill={MUTED}>{clip(settings.signatory_title || 'Authorised signatory', 28)}</text>
      )}

      {/* the dates */}
      <text x={316} y={318} fontSize={17} fill={INK}>
        <tspan fontWeight={700}>Joined Date: </tspan>
        <tspan>{cardDate(card.date_joined) || '—'}</tspan>
      </text>
      <text x={316} y={350} fontSize={17} fill={INK}>
        <tspan fontWeight={700}>Expiry Date: </tspan>
        <tspan>{formatCardDate(expiry) || '—'}</tspan>
      </text>

      {/* the QR code: opens the public check that says whether the person is a current employee */}
      <rect x={656} y={276} width={160} height={160} rx={12} fill="#FFFFFF" stroke="#E5E7EB" strokeWidth={2} />
      <QRCodeSVG value={verifyUrl(card.token, origin)} x={664} y={284} size={144} level="M" fgColor={INK} bgColor="#FFFFFF" />
      <text x={736} y={458} textAnchor="middle" fontSize={13} fontWeight={600} fill={MUTED}>Scan to verify</text>

      {/* the company's contacts */}
      <line x1={36} x2={620} y1={452} y2={452} stroke="#E5E7EB" strokeWidth={2} />
      <Logo branding={branding} x={36} y={464} size={48} clipId={logoClip} />
      <text x={98} y={484} fontSize={fit(clip(company, 34).length, 500, 19, 14)} fontWeight={800} fill={INK}>{clip(company, 34)}</text>
      {contact && <text x={98} y={507} fontSize={13.5} fill={MUTED}>{clip(contact, 72)}</text>}
      <rect x={0} y={H - 14} width={W} height={14} fill={primary} />
      <rect x={0} y={H - 14} width={W * 0.3} height={14} fill={secondary} />
    </Svg>
  );
}

/** The front, portrait or landscape (with the landscape card's own photo framing). */
export function StaffIdCardFront(props: CardFaceProps) {
  return props.layout === 'landscape'
    ? <LandscapeFront {...props} card={forLayout(props.card, 'landscape')} />
    : <PortraitFront {...props} />;
}

/** The back, portrait or landscape. */
export function StaffIdCardBack(props: CardFaceProps) {
  return props.layout === 'landscape' ? <LandscapeBack {...props} /> : <PortraitBack {...props} />;
}

/** Both faces side by side (one above the other on a narrow phone). */
export default function StaffIdCard(props: Omit<CardFaceProps, 'width' | 'className'>) {
  const face = `w-full ${props.layout === 'landscape' ? 'max-w-[400px]' : 'max-w-[260px]'} rounded-[14px] overflow-hidden shadow-md ring-1 ring-black/5`;
  return (
    <div className="flex flex-wrap justify-center gap-4" data-testid="staff-id-card">
      <div className={face}>
        <StaffIdCardFront {...props} />
      </div>
      <div className={face}>
        <StaffIdCardBack {...props} />
      </div>
    </div>
  );
}
