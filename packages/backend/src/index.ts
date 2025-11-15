import express from "express";
import cors from "cors";
import morgan from "morgan";

import "@db";
import config from "@config";
import logger from "@logger";
import router from "@routes";
import { errorHandler } from "@utils/error";

const app = express();
const PORT = config.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors());
app.use(
	morgan(
		`[:date[iso]] - :method :url :status :response-time ms - :res[content-length] ":user-agent"`
	)
);

app.use(router);
app.use(errorHandler);

app.listen(PORT, () => {
	logger.info(`Server is running on port ${PORT}`);
});
