import { Router } from "express";
import { z } from "zod";
import { canOverride, requireRole } from "../auth.js";
import { issue, reissue, returnCopy } from "../circulation.js";
import { AppError } from "../errors.js";

export const circulationRouter = Router();

const issueInput = z.object({
  memberCode: z.string().trim().min(1),
  barcode: z.string().trim().min(1),
  override: z.boolean().default(false),
});

circulationRouter.post("/circulation/issue", requireRole("assistant"), async (req, res) => {
  const data = issueInput.parse(req.body);
  if (data.override && !canOverride(req.user)) {
    throw new AppError(403, "Only a librarian can override borrowing limits");
  }
  res.status(201).json(await issue({ ...data, userId: req.user!.id }));
});

circulationRouter.post("/circulation/return", requireRole("assistant"), async (req, res) => {
  const { barcode } = z.object({ barcode: z.string().trim().min(1) }).parse(req.body);
  res.json(await returnCopy({ barcode, userId: req.user!.id }));
});

const reissueInput = z
  .object({
    loanId: z.number().int().optional(),
    barcode: z.string().trim().min(1).optional(),
    override: z.boolean().default(false),
  })
  .refine((d) => d.loanId || d.barcode, "Scan the book's barcode");

// "renew" is the older name for the same thing.
circulationRouter.post(["/circulation/reissue", "/circulation/renew"], requireRole("assistant"), async (req, res) => {
  const data = reissueInput.parse(req.body);
  if (data.override && !canOverride(req.user)) {
    throw new AppError(403, "Only a librarian can override re-issue limits");
  }
  res.json(await reissue({ ...data, userId: req.user!.id }));
});
