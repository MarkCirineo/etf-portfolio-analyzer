import { Router } from "express";
import fetch from "./fetch";
import create from "./create";
import detail from "./detail";
import update from "./update";
import jobs from "./jobs";

const router = Router();

router.use("/", fetch);
router.use("/", create);
router.use("/", detail);
router.use("/", update);
router.use("/", jobs);

export default router;
