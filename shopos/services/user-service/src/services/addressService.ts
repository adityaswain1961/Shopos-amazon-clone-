import { Address } from '../models/Address.js';
import { invalidateProfileCache } from './profileService.js';
import { AppError } from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import type { CreateAddressInput, UpdateAddressInput } from '../validators/user.validators.js';

const MAX_ADDRESSES = 10;

// ─── List Addresses ─────────────────────────────────────────────────

export async function listAddresses(userId: string) {
  return Address.find({ userId })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
}

// ─── Create Address ─────────────────────────────────────────────────

export async function createAddress(userId: string, data: CreateAddressInput) {
  // Enforce max 10 addresses
  const count = await Address.countDocuments({ userId });
  if (count >= MAX_ADDRESSES) {
    throw new AppError(`Maximum of ${MAX_ADDRESSES} addresses allowed`, 400);
  }

  const address = await Address.create({ userId, ...data });

  // If first address, set as default shipping and billing
  if (count === 0) {
    address.isDefaultShipping = true;
    address.isDefaultBilling = true;
    await address.save();
  }

  // Invalidate profile cache (addresses affect profile completeness)
  await invalidateProfileCache(userId);

  logger.info('Address created', { userId, addressId: address._id.toString() });
  return address;
}

// ─── Update Address ─────────────────────────────────────────────────

export async function updateAddress(
  userId: string,
  addressId: string,
  data: UpdateAddressInput,
) {
  const address = await Address.findOneAndUpdate(
    { _id: addressId, userId },
    { $set: data },
    { new: true, runValidators: true },
  );

  if (!address) {
    throw new AppError('Address not found', 404);
  }

  await invalidateProfileCache(userId);

  logger.info('Address updated', { userId, addressId });
  return address;
}

// ─── Delete Address ─────────────────────────────────────────────────

export async function deleteAddress(userId: string, addressId: string): Promise<void> {
  const address = await Address.findOneAndDelete({ _id: addressId, userId });

  if (!address) {
    throw new AppError('Address not found', 404);
  }

  // If deleted address was default, promote next one
  if (address.isDefaultShipping) {
    const next = await Address.findOne({ userId }).sort({ createdAt: -1 });
    if (next) {
      next.isDefaultShipping = true;
      await next.save();
    }
  }
  if (address.isDefaultBilling) {
    const next = await Address.findOne({ userId }).sort({ createdAt: -1 });
    if (next) {
      next.isDefaultBilling = true;
      await next.save();
    }
  }

  await invalidateProfileCache(userId);
  logger.info('Address deleted', { userId, addressId });
}

// ─── Set Default Address ────────────────────────────────────────────

export async function setDefaultAddress(
  userId: string,
  addressId: string,
  type: 'shipping' | 'billing',
): Promise<void> {
  const address = await Address.findOne({ _id: addressId, userId });
  if (!address) {
    throw new AppError('Address not found', 404);
  }

  if (type === 'shipping') {
    // Unset current default
    await Address.updateMany(
      { userId, isDefaultShipping: true },
      { $set: { isDefaultShipping: false } },
    );
    address.isDefaultShipping = true;
  } else {
    await Address.updateMany(
      { userId, isDefaultBilling: true },
      { $set: { isDefaultBilling: false } },
    );
    address.isDefaultBilling = true;
  }

  await address.save();
  await invalidateProfileCache(userId);

  logger.info('Default address set', { userId, addressId, type });
}
