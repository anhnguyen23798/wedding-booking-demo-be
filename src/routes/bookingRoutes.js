const express = require('express');
const router = express.Router();
const { 
  createBooking, 
  getMyBookings, 
  getAllBookings,
  createDraftContract,
  signContract,
  getContractStatus,
  updatePaymentReceipts,
  getPaymentReceipts,
  createFinalPayment
} = require('../controllers/bookingController');

// Booking + deposit (Stripe PI)
router.post('/', createBooking);
router.get('/me', getMyBookings);
router.get('/admin', getAllBookings);

// Contract management
router.post('/contract/draft', createDraftContract);
router.post('/contract/sign', signContract);
router.get('/contract/:bookingId', getContractStatus);

// Payment receipt management
router.put('/:bookingId/receipts', updatePaymentReceipts);
router.get('/:bookingId/receipts', getPaymentReceipts);

// Final payment
router.post('/final-payment', createFinalPayment);

// Final payment (Stripe Invoice)

module.exports = router;
