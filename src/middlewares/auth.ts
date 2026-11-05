import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../types";

export interface JwtPayload {
  sub: string;
  clinicId: string;
  role: "admin" | "receptionist";
}

export const requireAuth = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError(401, "Unauthorized", "Missing token"));
  }

  const token = header.replace("Bearer ", "").trim();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = {
      id: decoded.sub,
      clinicId: decoded.clinicId,
      role: decoded.role,
    };
    return next();
  } catch (error) {
    return next(new AppError(401, "Unauthorized", "Invalid token"));
  }
};

export const requireRole =
  (...roles: Array<JwtPayload["role"]>) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, "Forbidden", "Insufficient permissions"));
    }
    return next();
  };

export const requireClinicScope = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.user?.clinicId) {
    return next(new AppError(421, "Misdirected Request", "Clinic scope missing"));
  }
  return next();
};
