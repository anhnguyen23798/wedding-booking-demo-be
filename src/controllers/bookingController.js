const Booking = require('../models/Booking');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET);

/**
 * Create a booking and optionally a deposit PaymentIntent (e.g., 30%)
 */
exports.createBooking = async (req, res, next) => {
  try {
    const { totalPrice, currency = 'usd', depositPercent = 30 } = req.body;
    if (!totalPrice || totalPrice <= 0) return res.status(400).json({ message: 'Invalid totalPrice' });

    const depositAmount = Math.round((depositPercent / 100) * totalPrice);
    const booking = await Booking.create({ ...req.body, depositAmount, paymentStatus: 'pending', currency });

    // Create or reuse Stripe Customer
    const customer = await stripe.customers.create({
      email: booking.customerEmail,
      name: booking.customerName,
      metadata: { bookingId: booking._id.toString() }
    });
    booking.stripeCustomerId = customer.id;

    // Create PaymentIntent for deposit
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(depositAmount * 100),
      currency,
      customer: customer.id,
      metadata: { bookingId: booking._id.toString(), purpose: 'deposit' },
      automatic_payment_methods: { enabled: true }
    });

    booking.stripePaymentIntentId = paymentIntent.id;
    await booking.save();

    res.json({ bookingId: booking._id, clientSecret: paymentIntent.client_secret, depositAmount });
  } catch (err) { next(err); }
};

/**
 * Get current user's bookings by email
 */
exports.getMyBookings = async (req, res, next) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: 'Missing email' });
    const bookings = await Booking.find({ customerEmail: email }).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (err) { next(err); }
};

/**
 * Admin: list all bookings with optional filters
 */
exports.getAllBookings = async (req, res, next) => {
  try {
    const { from, to, status, hall } = req.query;
    const q = {};
    if (status) q.paymentStatus = status;
    if (hall) q.hall = hall;
    if (from || to) {
      q.date = {};
      if (from) q.date.$gte = new Date(from);
      if (to) q.date.$lte = new Date(to);
    }
    const bookings = await Booking.find(q).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (err) { next(err); }
};

/**
 * Helper function to create draft contract
 */
const createDraftContract = async (booking) => {
  try {
    // Simulate contract creation - in real app, this would generate PDF
    const contractData = {
      bookingId: booking._id,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      eventDate: booking.date,
      hall: booking.hall,
      package: booking.package,
      guests: booking.guests,
      totalPrice: booking.totalPrice,
      depositAmount: booking.depositAmount,
      currency: booking.currency,
      createdAt: new Date()
    };

    // Generate a mock contract URL (in real app, this would be actual PDF generation)
    const contractUrl = `${process.env.PUBLIC_BASE_URL || 'http://localhost:5000'}/contracts/${booking._id}-draft.pdf`;

    // Update booking with contract info
    booking.contract = {
      status: 'draft',
      draftUrl: contractUrl,
      createdAt: new Date()
    };

    await booking.save();
    console.log(`✅ Draft contract created for booking ${booking._id}`);
    return contractUrl;
  } catch (error) {
    console.error(`❌ Error creating draft contract for booking ${booking._id}:`, error);
    throw error;
  }
};

/**
 * Enhanced Stripe webhook for deposit/full payments with auto-contract and invoice creation
 */
exports.stripeWebhook = async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ message: 'Webhook secret not configured' });
  }

  const sig = req.headers['stripe-signature'];

  if (!sig) {
    console.error('No stripe-signature header found');
    return res.status(400).json({ message: 'No signature found' });
  }

  let event;

  try {
    // Verify the webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log('✅ Webhook signature verified successfully for event:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    console.error('Webhook body type:', typeof req.body);
    console.error('Webhook body length:', req.body ? req.body.length : 'undefined');
    console.error('Signature header:', sig);
    console.error('Webhook secret configured:', !!webhookSecret);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'charge.succeeded') {
      const charge = event.data.object;
      const paymentIntentId = charge.payment_intent;
      const bookingId = charge.metadata?.bookingId;

      console.log('🔄 Processing charge.succeeded for payment intent:', paymentIntentId);

      if (paymentIntentId && bookingId) {
        const booking = await Booking.findById(bookingId);
        if (!booking) {
          console.error(`❌ Booking not found: ${bookingId}`);
          return res.status(404).json({ message: 'Booking not found' });
        }

        // Check if this is deposit or final payment based on payment intent metadata
        if (charge.metadata?.purpose === 'deposit') {
          // Deposit payment succeeded
          console.log(`💰 Deposit payment succeeded for booking ${bookingId}`);
          booking.paymentStatus = 'deposit_paid';
          booking.depositPaidAt = new Date();

          // Get receipt URL directly from charge
          if (charge.receipt_url) {
            booking.paymentReceipts = { ...booking.paymentReceipts, deposit: charge.receipt_url };
            console.log(`📄 Deposit receipt URL captured: ${charge.receipt_url}`);
          } else {
            console.log('⚠️ No receipt URL found in charge data');
          }

          // Auto-create draft contract after deposit payment
          try {
            console.log(`📋 Auto-creating draft contract for booking ${bookingId}`);
            await createDraftContract(booking);
            console.log(`✅ Draft contract created successfully for booking ${bookingId}`);
          } catch (contractError) {
            console.error(`❌ Failed to auto-create contract for booking ${bookingId}:`, contractError);
            // Don't fail the webhook if contract creation fails
          }

          await booking.save();
          console.log(`✅ Booking deposit status updated to deposit_paid: ${bookingId}`);

        } else {
          // Final payment succeeded
          console.log(`💳 Final payment succeeded for booking ${bookingId}`);
          booking.paymentStatus = 'paid';
          booking.paidAt = new Date();

          // Get receipt URL directly from charge
          if (charge.receipt_url) {
            booking.paymentReceipts = { ...booking.paymentReceipts, final: charge.receipt_url };
            console.log(`📄 Final payment receipt URL captured: ${charge.receipt_url}`);
          } else {
            console.log('⚠️ No receipt URL found in charge data for final payment');
          }

          await booking.save();
          console.log(`✅ Booking payment status updated to paid: ${bookingId}`);
        }
      }
    }

    res.json({ received: true, processed: true });
  } catch (err) {
    console.error('❌ Webhook handling error:', err);
    res.status(500).json({ message: 'Webhook handling error' });
  }
};

/**
 * Create draft contract manually (for admin use)
 */
exports.createDraftContract = async (req, res, next) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ message: 'Missing bookingId' });

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    if (booking.contract?.status === 'draft') {
      return res.status(400).json({ message: 'Draft contract already exists' });
    }

    const contractUrl = await createDraftContract(booking);
    res.json({
      message: 'Draft contract created successfully',
      contractUrl,
      contract: booking.contract
    });
  } catch (err) { next(err); }
};

/**
 * Sign contract manually (for admin use)
 */
exports.signContract = async (req, res, next) => {
  try {
    const { bookingId, signerName } = req.body;
    if (!bookingId || !signerName) {
      return res.status(400).json({ message: 'Missing bookingId or signerName' });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    if (!booking.contract?.status === 'draft') {
      return res.status(400).json({ message: 'No draft contract found. Create draft first.' });
    }

    // Simulate contract signing - in real app, this would add signature to PDF
    const signedUrl = `${process.env.PUBLIC_BASE_URL || 'http://localhost:5000'}/contracts/${booking._id}-signed.pdf`;

    booking.contract.status = 'signed';
    booking.contract.signedUrl = signedUrl;
    booking.contract.signerName = signerName;
    booking.contract.signedAt = new Date();

    await booking.save();

    res.json({
      message: 'Contract signed successfully',
      signedUrl,
      contract: booking.contract
    });
  } catch (err) { next(err); }
};

/**
 * Get contract status for a booking
 */
exports.getContractStatus = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);

    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    res.json({
      bookingId: booking._id,
      contract: booking.contract || null,
      paymentStatus: booking.paymentStatus,
      paymentReceipts: booking.paymentReceipts || {}
    });
  } catch (err) { next(err); }
};

/**
 * Manually retrieve and update payment receipt URLs for a booking
 */
exports.updatePaymentReceipts = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);

    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    if (!booking.stripePaymentIntentId) {
      return res.status(400).json({ message: 'No Stripe payment intent found for this booking' });
    }

    // Get receipt URL for the payment intent
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
      const charge = paymentIntent.charges.data[0];

      if (charge && charge.receipt_url) {
        // Determine if this is deposit or final payment based on payment status
        if (booking.paymentStatus === 'deposit_paid') {
          booking.paymentReceipts = { ...booking.paymentReceipts, deposit: charge.receipt_url };
          console.log(`📄 Updated deposit receipt URL: ${charge.receipt_url}`);
        } else if (booking.paymentStatus === 'paid') {
          booking.paymentReceipts = { ...booking.paymentReceipts, final: charge.receipt_url };
          console.log(`📄 Updated final payment receipt URL: ${charge.receipt_url}`);
        }

        await booking.save();

        res.json({
          message: 'Payment receipt URLs updated successfully',
          paymentReceipts: booking.paymentReceipts
        });
      } else {
        res.status(404).json({ message: 'No receipt URL found for this payment' });
      }
    } catch (stripeError) {
      console.error('❌ Error retrieving payment intent:', stripeError);
      res.status(500).json({ message: 'Failed to retrieve payment information from Stripe' });
    }
  } catch (err) { next(err); }
};

/**
 * Get payment receipt information for a booking
 */
exports.getPaymentReceipts = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);

    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    res.json({
      bookingId: booking._id,
      paymentStatus: booking.paymentStatus,
      paymentReceipts: booking.paymentReceipts || {},
      depositAmount: booking.depositAmount,
      totalPrice: booking.totalPrice,
      currency: booking.currency
    });
  } catch (err) { next(err); }
};

/**
 * Create final payment PaymentIntent for remaining balance
 */
exports.createFinalPayment = async (req, res, next) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ message: 'Missing bookingId' });

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    if (booking.paymentStatus === 'paid') {
      return res.status(400).json({ message: 'Booking is already fully paid' });
    }

    if (booking.paymentStatus !== 'deposit_paid') {
      return res.status(400).json({ message: 'Deposit must be paid before creating final payment' });
    }

    const remainingAmount = Math.max(0, booking.totalPrice - (booking.depositAmount || 0));
    if (remainingAmount <= 0) {
      return res.status(400).json({ message: 'No remaining balance to pay' });
    }

    // Create or reuse Stripe Customer
    if (!booking.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: booking.customerEmail,
        name: booking.customerName,
        metadata: { bookingId: booking._id.toString() }
      });
      booking.stripeCustomerId = customer.id;
      await booking.save();
    }

    // Create PaymentIntent for final payment
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(remainingAmount * 100),
      currency: booking.currency || 'usd',
      customer: booking.stripeCustomerId,
      metadata: { 
        bookingId: booking._id.toString(), 
        purpose: 'final_payment',
        depositAmount: booking.depositAmount,
        totalPrice: booking.totalPrice
      },
      automatic_payment_methods: { enabled: true }
    });

    res.json({
      message: 'Final payment PaymentIntent created successfully',
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: remainingAmount,
      currency: booking.currency
    });
  } catch (err) { next(err); }
};
