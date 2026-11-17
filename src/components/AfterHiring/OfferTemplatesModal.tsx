import LetterTemplatesModal from './LetterTemplatesModal';
import { OFFER_PLACEHOLDERS, deleteOfferTemplate, loadOfferTemplates, saveOfferTemplate } from '../../lib/offers';

// The company's offer letter templates: a title and a body with placeholders. The default one starts every new offer.
export default function OfferTemplatesModal({ onClose }: { onClose: () => void }) {
  return (
    <LetterTemplatesModal
      heading="Offer letter templates"
      placeholders={OFFER_PLACEHOLDERS}
      newTitle="Offer of employment"
      defaultLabel="Use for new offers (default)"
      load={loadOfferTemplates}
      save={saveOfferTemplate}
      remove={deleteOfferTemplate}
      deleteNote="Offers already written keep their text."
      onClose={onClose}
    />
  );
}
