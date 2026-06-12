import { getPrismaClient } from '../config/prisma.js';
import { getRedisClient } from '../config/redis.js';
import { publishEvent } from '../config/kafka.js';
import { AppError } from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import type { KafkaEvent, CategoryCreatedPayload, CategoryUpdatedPayload, CategoryDeletedPayload } from '@shopos/shared-types';

const CATEGORY_TREE_CACHE_KEY = 'products:categories:tree';
const CATEGORY_CACHE_PREFIX = 'products:categories:';
const CACHE_TTL = 86400; // 24 hours

export interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  createdAt: Date;
  children: CategoryTreeNode[];
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

async function invalidateCategoryCaches(id?: string, slug?: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const keys = [CATEGORY_TREE_CACHE_KEY];
    if (id) keys.push(`${CATEGORY_CACHE_PREFIX}${id}`);
    if (slug) keys.push(`${CATEGORY_CACHE_PREFIX}${slug}`);
    await redis.del(...keys);
  } catch (error) {
    logger.error('Failed to invalidate category cache', { error });
  }
}

export async function createCategory(data: {
  name: string;
  slug?: string;
  description?: string | null;
  parentId?: string | null;
}) {
  const prisma = getPrismaClient();
  const slug = data.slug ? generateSlug(data.slug) : generateSlug(data.name);

  // Ensure unique name
  const existingName = await prisma.category.findFirst({ where: { name: data.name } });
  if (existingName) {
    throw new AppError('Category with this name already exists', 400);
  }

  // Ensure unique slug
  const existingSlug = await prisma.category.findUnique({ where: { slug } });
  if (existingSlug) {
    throw new AppError('Category with this slug already exists', 400);
  }

  // Verify parent if provided
  if (data.parentId) {
    const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
    if (!parent) {
      throw new AppError('Parent category not found', 404);
    }
  }

  const category = await prisma.category.create({
    data: {
      name: data.name,
      slug,
      description: data.description || null,
      parentId: data.parentId || null,
    },
  });

  await invalidateCategoryCaches();

  // Publish Kafka Event
  const event: KafkaEvent<CategoryCreatedPayload> = {
    eventId: uuidv4(),
    type: 'category.created',
    timestamp: new Date().toISOString(),
    version: '1.0',
    payload: {
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId,
      createdAt: category.createdAt.toISOString(),
    },
  };
  await publishEvent('product.categories', event);

  return category;
}

export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  const redis = getRedisClient();

  try {
    const cached = await redis.get(CATEGORY_TREE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    logger.error('Failed to fetch category tree from cache', { error });
  }

  const prisma = getPrismaClient();
  const allCategories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
  });

  // Build tree hierarchy
  const buildTree = (parentId: string | null): CategoryTreeNode[] => {
    return allCategories
      .filter((cat) => cat.parentId === parentId)
      .map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        parentId: cat.parentId,
        createdAt: cat.createdAt,
        children: buildTree(cat.id),
      }));
  };

  const tree = buildTree(null);

  try {
    await redis.setex(CATEGORY_TREE_CACHE_KEY, CACHE_TTL, JSON.stringify(tree));
  } catch (error) {
    logger.error('Failed to save category tree to cache', { error });
  }

  return tree;
}

export async function getCategoryByIdOrSlug(idOrSlug: string) {
  const redis = getRedisClient();
  const cacheKey = `${CATEGORY_CACHE_PREFIX}${idOrSlug}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    logger.error('Failed to fetch category from cache', { idOrSlug, error });
  }

  const prisma = getPrismaClient();
  const isUuid = idOrSlug.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

  const category = await prisma.category.findUnique({
    where: isUuid ? { id: idOrSlug } : { slug: idOrSlug },
    include: {
      parent: true,
      children: true,
    },
  });

  if (!category) {
    throw new AppError('Category not found', 404);
  }

  try {
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(category));
  } catch (error) {
    logger.error('Failed to save category to cache', { idOrSlug, error });
  }

  return category;
}

export async function updateCategory(
  id: string,
  data: {
    name?: string;
    slug?: string;
    description?: string | null;
    parentId?: string | null;
  },
) {
  const prisma = getPrismaClient();
  const current = await prisma.category.findUnique({ where: { id } });
  if (!current) {
    throw new AppError('Category not found', 404);
  }

  const updateData: any = {};
  if (data.name !== undefined) {
    updateData.name = data.name;
    updateData.slug = data.slug ? generateSlug(data.slug) : generateSlug(data.name);

    // Check unique name if changed
    if (data.name !== current.name) {
      const existingName = await prisma.category.findFirst({ where: { name: data.name } });
      if (existingName) {
        throw new AppError('Category with this name already exists', 400);
      }
    }

    // Check unique slug if changed
    if (updateData.slug !== current.slug) {
      const existingSlug = await prisma.category.findUnique({ where: { slug: updateData.slug } });
      if (existingSlug) {
        throw new AppError('Category with this slug already exists', 400);
      }
    }
  } else if (data.slug !== undefined) {
    updateData.slug = generateSlug(data.slug);
    if (updateData.slug !== current.slug) {
      const existingSlug = await prisma.category.findUnique({ where: { slug: updateData.slug } });
      if (existingSlug) {
        throw new AppError('Category with this slug already exists', 400);
      }
    }
  }

  if (data.description !== undefined) {
    updateData.description = data.description;
  }

  if (data.parentId !== undefined) {
    if (data.parentId === id) {
      throw new AppError('Category cannot be its own parent', 400);
    }
    if (data.parentId) {
      // Verify parent exists
      const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
      if (!parent) {
        throw new AppError('Parent category not found', 404);
      }

      // Prevent cyclical loops: parent cannot be a child of this category
      let cursor: string | null = data.parentId;
      for (let depth = 0; depth < 20 && cursor; depth++) {
        const parentRow: { parentId: string | null } | null = await prisma.category.findUnique({
          where: { id: cursor as string },
          select: { parentId: true },
        });
        if (!parentRow) break;
        if (parentRow.parentId === id) {
          throw new AppError('Cyclic hierarchy detected. Parent cannot be a child of this category.', 400);
        }
        cursor = parentRow.parentId;
      }
    }
    updateData.parentId = data.parentId;
  }

  const updatedCategory = await prisma.category.update({
    where: { id },
    data: updateData,
  });

  await invalidateCategoryCaches(id, current.slug);
  if (updatedCategory.slug !== current.slug) {
    await invalidateCategoryCaches(undefined, updatedCategory.slug);
  }

  // Publish Kafka Event
  const event: KafkaEvent<CategoryUpdatedPayload> = {
    eventId: uuidv4(),
    type: 'category.updated',
    timestamp: new Date().toISOString(),
    version: '1.0',
    payload: {
      id: updatedCategory.id,
      name: updatedCategory.name,
      slug: updatedCategory.slug,
      parentId: updatedCategory.parentId,
      updatedAt: new Date().toISOString(),
    },
  };
  await publishEvent('product.categories', event);

  return updatedCategory;
}

export async function deleteCategory(id: string): Promise<void> {
  const prisma = getPrismaClient();

  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) {
    throw new AppError('Category not found', 404);
  }

  const childCount = await prisma.category.count({ where: { parentId: id } });
  if (childCount > 0) {
    throw new AppError('Cannot delete category containing subcategories. Delete children first.', 400);
  }

  const productCount = await prisma.product.count({ where: { categoryId: id, status: { not: 'archived' } } });
  if (productCount > 0) {
    throw new AppError('Cannot delete category containing active products. Reassign or delete products first.', 400);
  }

  await prisma.category.delete({ where: { id } });

  await invalidateCategoryCaches(id, category.slug);

  // Publish Kafka Event
  const event: KafkaEvent<CategoryDeletedPayload> = {
    eventId: uuidv4(),
    type: 'category.deleted',
    timestamp: new Date().toISOString(),
    version: '1.0',
    payload: {
      id: category.id,
      deletedAt: new Date().toISOString(),
    },
  };
  await publishEvent('product.categories', event);
}
