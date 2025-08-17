const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  customerEmail: { type: String, required: true, index: true },
  date: { type: Date, required: true },
  hall: { type: String, required: true },
  package: { type: String, required: true },
  guests: { type: Number, required: true, min: 1 },
  notes: { type: String },
  totalPrice: { type: Number, required: true, min: 0 },
  depositAmount: { type: Number, default: 0 },
  depositPercent: { type: Number, default: 30, min: 10, max: 50 },
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'deposit_paid', 'paid', 'failed'], 
    default: 'pending' 
  },
  stripePaymentIntentId: { type: String },
  stripeCustomerId: { type: String },
  currency: { type: String, default: 'usd' },
  
  // Payment tracking
  depositPaidAt: { type: Date },
  paidAt: { type: Date },
  lastPaymentAttempt: { type: Date },
  
  // Payment receipts
  paymentReceipts: {
    deposit: String,  // Receipt URL for deposit payment
    final: String     // Receipt URL for final payment
  },
  
  // Contract management
  contract: {
    status: { 
      type: String, 
      enum: ['none', 'draft', 'sent', 'signed'], 
      default: 'none' 
    },
    draftUrl: String,
    signedUrl: String,
    signerName: String,
    createdAt: Date,
    signedAt: Date
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual fields for calculated values
bookingSchema.virtual('remainingAmount').get(function() {
  return Math.max(0, this.totalPrice - (this.depositAmount || 0));
});

bookingSchema.virtual('isFullyPaid').get(function() {
  return this.paymentStatus === 'paid';
});

bookingSchema.virtual('hasDepositPaid').get(function() {
  return this.paymentStatus === 'deposit_paid' || this.paymentStatus === 'paid';
});

bookingSchema.virtual('contractStatus').get(function() {
  return this.contract?.status || 'none';
});

// Indexes for better query performance
bookingSchema.index({ paymentStatus: 1, date: 1 });
bookingSchema.index({ 'contract.status': 1 });
bookingSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Booking', bookingSchema);
