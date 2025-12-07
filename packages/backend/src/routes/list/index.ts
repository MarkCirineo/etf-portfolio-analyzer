import { Router } from "express";
import fetch from "./fetch";
import create from "./create";
import detail from "./detail";

const router = Router();

router.use("/", fetch);
router.use("/", create);
router.use("/", detail);

export default router;
