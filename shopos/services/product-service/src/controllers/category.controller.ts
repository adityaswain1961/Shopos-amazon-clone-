import { Request, Response, NextFunction } from 'express';
import * as categoryService from '../services/categoryService.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function listCategories(_req: Request, res: Response, next: NextFunction) {
  try {
    const tree = await categoryService.getCategoryTree();
    sendSuccess(res, tree);
  } catch (error) {
    next(error);
  }
}

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await categoryService.createCategory(req.body);
    res.status(201);
    sendSuccess(res, category);
  } catch (error) {
    next(error);
  }
}

export async function getCategoryBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await categoryService.getCategoryByIdOrSlug(String(req.params.slug));
    sendSuccess(res, category);
  } catch (error) {
    next(error);
  }
}
