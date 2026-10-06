import { Router } from "express";
import fetch from "./fetch";
import create from "./create";
import detail from "./detail";
import update from "./update";
import primary from "./primary";
import accounts from "./accounts";

const router = Router();

router.use("/", fetch);
router.use("/", create);
router.use("/", detail);
router.use("/", update);
router.use("/", primary);
router.use("/", accounts);

export default router;
