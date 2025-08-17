# Wedding Booking Backend (US flow: Stripe + Contract e-sign demo)

## What this backend does
- Creates **Booking** with **Stripe deposit PaymentIntent** (default 30%).
- Generates **Contract PDF (draft)** and a simple **e-sign** (creates "signed" PDF).
- Creates & sends **Stripe Invoice** for the remaining balance.

## Setup
```
cp .env.example .env
npm install
npm run dev
```
Set in `.env`:
- `MONGO_URI`
- `STRIPE_SECRET`
- `STRIPE_WEBHOOK_SECRET` (from Stripe Dashboard)
- `PUBLIC_BASE_URL` (e.g., http://localhost:5000)

## Key endpoints
- `POST /api/bookings` → create booking + PI for deposit → returns `clientSecret`, `bookingId`  
- `POST /api/bookings/contract/draft` → create draft contract PDF → returns `draftUrl`  
- `POST /api/bookings/contract/sign` → sign contract (demo) → returns `signedUrl`  
- `POST /api/bookings/invoice/create` → create + send Stripe invoice for remaining

## Webhook
Stripe Dashboard → endpoint: `/api/stripe/webhook` with `payment_intent.succeeded`
