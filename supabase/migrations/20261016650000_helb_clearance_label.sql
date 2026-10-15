-- The HELB document is the HELB clearance certificate, not a "compliance" certificate.
update public.document_types
   set label = 'HELB clearance certificate'
 where code = 'helb_certificate'
   and label = 'HELB compliance certificate';
