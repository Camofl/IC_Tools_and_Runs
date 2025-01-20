const fs = require("fs");

const elements = fs
    .readFileSync("./elements.txt", { encoding: "utf8" })
    .split("\n")
    .map((x) => x.trim());

const revivedElements = Array.from(
    new Set(
        fs
            .readFileSync("./revivedElements.txt", { encoding: "utf8" })
            .split("\n")
            .map((x) => x.trim().toLowerCase()) // Normalize casing for case-insensitive checks
    )
);

const puppeteer = require("puppeteer-extra"),
    StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const aliveFile = "aliveElements.txt";
const deadFile = "deadElements.txt";

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox'],
        protocolTimeout: 0, // No timeout for protocol operations
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(0); // Disable page-level timeout
    page.setDefaultNavigationTimeout(0); // Disable navigation timeout


    await page.goto("https://neal.fun/infinite-craft", {
        waitUntil: "domcontentloaded",
    });

    // Ensure both files are cleared before starting
    fs.writeFileSync(aliveFile, "");
    fs.writeFileSync(deadFile, "");

    // Define a function to append results to the respective file
    await page.exposeFunction("writeResult", (data) => {
        try {
            const { value } = JSON.parse(data);
            const { element } = JSON.parse(data);
            const targetFile = value === "alive" ? aliveFile : deadFile;
            fs.appendFileSync(targetFile, `${element}\n`, { encoding: "utf8" });
        } catch (err) {
            console.error("Failed to write to file:", err);
        }
    });

    try {
        page.on("console", async (msg) => {
            const msgArgs = msg.args();
            for (let i = 0; i < msgArgs.length; ++i) {
                console.log(await msgArgs[i].jsonValue());
            }
        });

        await page.evaluate(
            async (elements, revivedElements) => {
                function sleep(ms) {
                    return new Promise((resolve) => setTimeout(resolve, ms));
                }

                function startCase(x) {
                    return x
                        .split(" ")
                        .map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase())
                        .join(" ");
                }

                async function fetchWithTimeout(resource, timeout = 3000) {
                    const controller = new AbortController();
                    const id = setTimeout(() => controller.abort(), timeout);
                    try {
                        const response = await fetch(resource, { signal: controller.signal });
                        clearTimeout(id);
                        return response;
                    } catch (error) {
                        clearTimeout(id);
                        throw error;
                    }
                }

                async function isDead(element, checker = element, retries = 3) {
                    const correctCasing = startCase(element);
                    const url = `/api/infinite-craft/pair?first=${encodeURIComponent(
                        correctCasing
                    )}&second=${encodeURIComponent(checker)}`;

                    for (let attempt = 0; attempt <= retries; attempt++) {
                        try {
                            const response = await fetchWithTimeout(url, 3000).then((x) =>
                                x.json()
                            );
                            let status = "alive";
                            if (response.result === "Nothing") status = "dead";
                            return status;
                        } catch (error) {
                            console.warn(
                                `Attempt ${attempt + 1}: Failed to fetch for ${element} (${checker})`,
                                error
                            );
                            if (attempt === retries) {
                                console.error(`Final failure for ${element} (${checker})`);
                                return "unknown";
                            }
                        }
                    }
                }

                const revivedSet = new Set(revivedElements);

                for (let element of elements) {
                    if (element.length > 30) continue;
                    try {
                        const normalizedElement = element.trim().toLowerCase();
                        if (revivedSet.has(normalizedElement)) {
                            console.log({ element, value: "alive", fromCache: true });
                            await window.writeResult(
                                JSON.stringify({ element, value: "alive", fromCache: true })
                            );
                            continue;
                        }

                        let time = Date.now();
                        const status = {
                            element,
                            value: null,
                            againstQM: await isDead(element, "?"),
                        };
                        status.value = status.againstQM;

                        if (status.againstQM === "dead") {
                            await sleep(500 - (Date.now() - time));
                            time = Date.now();
                            status.againstTQM = await isDead(element, "???");
                            if (status.againstTQM === "alive") status.value = "alive";
                        }

                        console.log(status);

                        await window.writeResult(JSON.stringify(status));

                        await sleep(300 - (Date.now() - time));
                    } catch (error) {
                        console.error(`Error processing element: ${element}`, error);
                    }
                }
            },
            elements,
            revivedElements // Pass as an array
        );
    } finally {
        await browser.close();
    }
})();
