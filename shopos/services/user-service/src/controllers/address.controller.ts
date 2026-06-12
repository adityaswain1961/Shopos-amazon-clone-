import type { Request, Response, NextFunction } from 'express';
import * as addressService from '../services/addressService.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';

// ─── List Addresses ─────────────────────────────────────────────────

export async function listAddresses(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const addresses = await addressService.listAddresses(req.user.sub);
    sendSuccess(res, { addresses });
  } catch (error) {
    next(error);
  }
}

// ─── Create Address ─────────────────────────────────────────────────

export async function createAddress(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const address = await addressService.createAddress(req.user.sub, req.body);
    sendSuccess(res, { address }, 201);
  } catch (error) {
    next(error);
  }
}

// ─── Update Address ─────────────────────────────────────────────────

export async function updateAddress(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const addressId = req.params['id'] as string;
    const address = await addressService.updateAddress(req.user.sub, addressId, req.body);
    sendSuccess(res, { address });
  } catch (error) {
    next(error);
  }
}

// ─── Delete Address ─────────────────────────────────────────────────

export async function deleteAddress(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const addressId = req.params['id'] as string;
    await addressService.deleteAddress(req.user.sub, addressId);
    sendSuccess(res, { message: 'Address deleted successfully' });
  } catch (error) {
    next(error);
  }
}

// ─── Set Default Address ────────────────────────────────────────────

export async function setDefault(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const addressId = req.params['id'] as string;
    const { type } = req.body;
    await addressService.setDefaultAddress(req.user.sub, addressId, type);
    sendSuccess(res, { message: `Default ${type} address updated` });
  } catch (error) {
    next(error);
  }
}
