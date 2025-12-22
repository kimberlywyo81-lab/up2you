import { Router } from 'express';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-12-15.clover',
});

// Create Payment Intent
router.post('/create-payment-intent', async (req: Request, res: Response) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      res.status(400).json({ error: 'Stripe not configured' });
      return;
    }
    const { amount, currency = 'usd' } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Config status
router.get('/config', (req: Request, res: Response) => {
  res.json({ configured: Boolean(process.env.STRIPE_SECRET_KEY), webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET) });
});

// Webhook Handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !endpointSecret) {
    res.status(400).send('Missing signature or secret');
    return;
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig as string, endpointSecret);
  } catch (err: any) {
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('PaymentIntent was successful!', paymentIntent.id);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.send();
});

export const stripeRoutes = router;
