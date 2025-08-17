const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const dayjs = require('dayjs');
const Booking = require('../models/Booking');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/**
 * Create a draft contract PDF for a booking
 */
exports.createDraft = async (req, res, next) => {
  try {
    const { bookingId } = req.body;
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    const contractsDir = path.join(__dirname, '..', '..', 'storage', 'contracts');
    ensureDir(contractsDir);
    const filename = `contract_${bookingId}_draft.pdf`;
    const filePath = path.join(contractsDir, filename);

    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(filePath));

    doc.fontSize(20).text('Wedding Services Agreement', { align: 'center' }).moveDown();
    doc.fontSize(12).text(`Date: ${dayjs().format('YYYY-MM-DD HH:mm')}`);
    doc.text(`Client Name: ${booking.customerName}`);
    doc.text(`Client Email: ${booking.customerEmail}`);
    doc.text(`Event Date: ${dayjs(booking.date).format('YYYY-MM-DD')}`);
    doc.text(`Hall: ${booking.hall}`);
    doc.text(`Package: ${booking.package}`);
    doc.text(`Guests: ${booking.guests}`);
    doc.text(`Total Price: ${booking.totalPrice} ${booking.currency.toUpperCase()}`);
    doc.moveDown();
    doc.text('Terms & Conditions:');
    doc.list([
      'Deposit is non-refundable after 7 days.',
      'Final payment due 14 days before event date.',
      'Cancellation policy applies as per venue rules.',
      'Electronic signatures are legally binding (ESIGN Act, UETA).'
    ]);
    doc.moveDown();
    doc.text('Signature: _____________________________  Date: ____________');
    doc.end();

    const publicBase = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const url = `${publicBase}/contracts/${filename}`;

    booking.contract = { ...booking.contract, status: 'draft', draftUrl: url };
    await booking.save();

    res.json({ draftUrl: url });
  } catch (err) { next(err); }
};

/**
 * E-sign the contract (simple demo: create a new PDF with signature details)
 */
exports.signContract = async (req, res, next) => {
  try {
    const { bookingId, signerName } = req.body;
    if (!signerName) return res.status(400).json({ message: 'signerName is required' });
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    const contractsDir = path.join(__dirname, '..', '..', 'storage', 'contracts');
    ensureDir(contractsDir);
    const filename = `contract_${bookingId}_signed.pdf`;
    const filePath = path.join(contractsDir, filename);

    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(filePath));

    doc.fontSize(20).text('Wedding Services Agreement (Signed)', { align: 'center' }).moveDown();
    doc.fontSize(12).text(`Signed At: ${dayjs().format('YYYY-MM-DD HH:mm')}`);
    doc.text(`Signer Name: ${signerName}`);
    doc.text(`Signer Email: ${booking.customerEmail}`);
    doc.moveDown();
    doc.text('Booking Details:');
    doc.text(`Event Date: ${dayjs(booking.date).format('YYYY-MM-DD')}`);
    doc.text(`Hall: ${booking.hall}`);
    doc.text(`Package: ${booking.package}`);
    doc.text(`Total Price: ${booking.totalPrice} ${booking.currency.toUpperCase()}`);
    doc.moveDown();
    doc.text('By signing electronically, the client agrees to the Terms & Conditions.');
    doc.end();

    const publicBase = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const url = `${publicBase}/contracts/${filename}`;

    booking.contract = {
      status: 'signed',
      draftUrl: booking.contract?.draftUrl,
      signedUrl: url,
      signerName,
      signedAt: new Date()
    };
    await booking.save();

    res.json({ signedUrl: url });
  } catch (err) { next(err); }
};
