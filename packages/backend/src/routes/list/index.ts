import { Router } from "express";
import fetch from "./fetch";
import create from "./create";

const router = Router();

router.use("/", fetch);
router.use("/", create);

export default router;
