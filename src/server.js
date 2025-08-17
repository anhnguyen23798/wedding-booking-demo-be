require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const bookingRoutes = require('./routes/bookingRoutes');
const Stripe = require('stripe');

const app = express();
connectDB();

// Serve contracts as static files
app.use('/contracts', express.static(path.join(__dirname, '..', 'storage', 'contracts')));

// CORS
app.use(cors({
  origin: '*', // Cho phép tất cả
}));

// Stripe webhook must use raw body - MUST BE BEFORE express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./controllers/bookingController').stripeWebhook);

// JSON body parser for all other routes
app.use(express.json());

// Routes
app.use('/api/bookings', bookingRoutes);

// Error handlers
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`[Server] running on http://localhost:${PORT}`));
