import { Router } from "express";
import login from "./login";
import signup from "./signup";
import logout from "./logout";
import me from "./me";

const router = Router();

router.use("/login", login);
router.use("/signup", signup);
router.use("/logout", logout);
router.use("/me", me);

export default router;
