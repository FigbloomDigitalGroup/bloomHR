// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { signContractPdf } from './contractSignature';

// a 1 x 1 PNG, standing in for a drawn signature
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
);

async function contract(pages: number, size: [number, number] = [595.28, 841.89]) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage(size);
  return pdf.save();
}

const signer = {
  name: 'Collins Kimeli',
  employeeNumber: 'FBL-000012',
  title: 'Employment contract 2027',
  signedAt: new Date('2026-11-20T09:41:00Z'),
  signature: PNG,
  originalSha256: 'a'.repeat(64),
};

describe('signContractPdf', () => {
  it('keeps every page of the contract and adds one signature page of the same size', async () => {
    const signed = await PDFDocument.load(await signContractPdf(await contract(3, [612, 792]), signer));
    expect(signed.getPageCount()).toBe(4);
    const last = signed.getPage(3).getSize();
    expect(last).toEqual({ width: 612, height: 792 });
  });

  it('a name with characters the PDF font cannot draw still signs', async () => {
    const signed = await PDFDocument.load(await signContractPdf(await contract(1), { ...signer, name: 'Ñandú 😀 Mwangi' }));
    expect(signed.getPageCount()).toBe(2);
  });

  it('a file that is not a readable PDF is refused with a way forward', async () => {
    await expect(signContractPdf(new TextEncoder().encode('not a pdf'), signer)).rejects.toThrow(/upload the signed copy/);
  });
});
