import { Router } from "express";
import { z } from "zod";
import { canOverride, requireRole } from "../auth.js";
import { issue, renew, returnCopy } from "../circulation.js";
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

circulationRouter.post("/circulation/renew", requireRole("assistant"), async (req, res) => {
  const { loanId } = z.object({ loanId: z.number().int() }).parse(req.body);
  res.json(await renew({ loanId, userId: req.user!.id }));
});
