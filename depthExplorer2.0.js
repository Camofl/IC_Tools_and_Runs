const fs = require("fs");
const readline = require('readline');


const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());


// Settings
const combineTime = 260;    // ms
const combineRetries = 3;   // Maximum retries for a failed combination
const combineLogs = true;

const stopAfterDepth = 5;
const parallelBots = 10;    // Number of concurrent workers (probably dont modify this)


const baseElements = ["Plant", "Tree", "River", "Delta", "Paper", "Book", "Alphabet", "Word", "Sentence", "Phrase", "Quote", "Punctuation", "Period", "Comma", "List", "Stop", "Tweet", "Delete", "Delete.", "Delete List"].map(icCase);
// ["Plant", "Tree", "River", "Delta", "Paper", "Book", "Alphabet", "Word", "Sentence", "Phrase", "Quote", "Punctuation", "Period", "Comma", "List", "Stop", "Tweet", "Delete", "Delete.", "Apostrophe", "Full Stop", "End", "The", "The’", "Delete The", "Letter", "The Quotation", "Letter Q", "Delete The Q"]
// gen 5 done ["Plant", "Tree", "Ash", "Pencil", "Paper", "Book", "Homework", "Coffee", "A", "Alphabet", "Study", "Grammar", "Punctuation", "Ampersand", "@"]
// gen 6 done ["Plant", "Tree", "River", "Delta", "Paper", "Book", "Alphabet", "Word", "Sentence", "Phrase", "Quote", "Punctuation"]
// ["Plant", "Tree", "River", "Delta", "Paper", "Book", "Alphabet", "Word", "Sentence", "Phrase", "Quote", "Punctuation", "Apostrophe", "Period", "Full Stop", "End", "Dust", "Clean", "Begin", "'"]
// ["Smoke", "Dust", "Planet", "Sun", "Sunflower", "Smoke Signal", "Message", "Letter", "A"]
// ["Plant", "Tree", "Ash", "Pencil", "Paper", "Book", "Homework", "Coffee", "A"]
// ["Smoke", "Cloud", "Lightning", "Sun", "Sunflower", "Smoke Signal", "Message", "Letter", "A"]

const baseBaseElements = ["Fire", "Water", "Earth", "Wind"];
const fullBaseSet = new Set([...baseBaseElements, ...baseElements]);
// elements the bot combines everything with
const tempElements = [];


// const printLineagesFor = new Set(["Hashtag", "Punctuation", "Grammar", "Grammar", "Sentence", "Quote", "Phrase", "Period", "Comma", "Colon", "Semicolon", "Parenthesis", "Parentheses", "Slash", "Alphabetical", "Ampersand", "Abrreviation", "Not", "Quotation", "Hyphen", "Dash", "Addition", "Minus", "Plus", "Power", "Plural", "Cross", "Palindrome", "42", "Question", "Answer", "Universe"]);
const printLineagesFor = new Set(["Delete The Parentheses", "Delete The Hyphen", "Delete The Dot", "Delete The Abc", "Delete The Abcd", "Delete The Mr."])
// const printLineageCondition = (element) => (printLineagesFor.has(element) || element.length === 1 || /^Delete .{1,2}$/i.test(element) || /^Delete The .{1,2}$/i.test(element) || /^Delete The Letter .$/i.test(element) || /Delete First/i.test(element) || /Delete Last/i.test(element) || /Remove/i.test(element))
const printLineageCondition = (element) => false
const printProgressEvery = {time: 60 * 1000, elements: 1000}


// default set()s have a size limit of 2**24, so im using multiple!!
class ChunkedSet {
    constructor(chunkSize = 2 ** 24) {
        this.chunkSize = chunkSize; // Max number of items in one chunk
        this.chunks = [new Set()]; // Array of sets (chunks)
    }

    add(value) {
        if (this.has(value)) return;
        if (this.chunks[this.chunks.length - 1].size >= this.chunkSize) {
            this.chunks.push(new Set());
        }
        this.chunks[this.chunks.length - 1].add(value);
    }

    has(value) {
        return this.chunks.some(chunk => chunk.has(value));
    }

    get size() {
        return this.chunks.reduce((total, chunk) => total + chunk.size, 0);
    }

    * values() {
        for (const chunk of this.chunks) {
            yield* chunk;
        }
    }
}


const depthLists = [ /* Depth */ new ChunkedSet()];
depthLists[0].add("");
const encounteredElements = new Map(); // { element: seeds }

const recipesIng = loadRecipes();
const recipesRes = new Map();

const precomputedRecipesRes = new Map();  // optimization for printing all Lineages

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastCombination = Date.now();

// const tempSet = new Set();


let processedSeeds = 0;
let totalSeeds = 0;
let depth = 0;
let startTime = Date.now();


(async () => {
    const browser = await puppeteer.launch({headless: true}); // false for debugging
    const page = await browser.newPage();

    await page.goto("https://neal.fun/infinite-craft", {waitUntil: "domcontentloaded"});
    console.log("Page loaded successfully!");
    console.log("For help with commands type 'help'");


    (async function main() {
        const interval = setInterval(() => {
            printSeedProgress();
        }, printProgressEvery.time);

        // calculate depth1 ONCE  (set)
        const depth1 = await processCombinations(allCombinations([...fullBaseSet]));

        for (; depth < stopAfterDepth; depth++) {
            depthLists[depth + 1] = new ChunkedSet();
            processedSeeds = 0;
            totalSeeds = depthLists[depth].size;


            async function worker(seedGen) {
                for (let seed of seedGen) {
                    seed = seed ? seed.split('=') : [];

                    const combElements = [...seed.map(x => icCase(x)), ...fullBaseSet];

                    let allResults = new Set(depth1);    // use prebcalculated depth1
                    // do all non base-base combinations as those are already in depth1
                    for (let i = 0; i < seed.length; i++) {
                        for (let j = i; j < combElements.length; j++) {
                            const combination = [combElements[i], combElements[j]].sort();
                            const combString = combination.join('=');
                            let recExists = recipesIng[combString];

                            if (recExists) {
                                if (!recipesRes.has(recExists)) recipesRes.set(recExists, new Set());
                                recipesRes.get(recExists).add(combString);
                            } else recExists = await combine(...combination);

                            if (recExists !== "Nothing") allResults.add(recExists);
                        }
                    }


                    for (const result of allResults) {
                        if (seed.includes(result) || fullBaseSet.has(result)) continue;

                        seed.push(result);

                        addToEncounteredElements(result, seed);

                        if (tempElements.length > 0) {
                            const tempResults = await processCombinations(tempElements.map(x => [x, result]));
                            for (const tempResult of tempResults) {
                                addToEncounteredElements(tempResult, [...seed, tempResult]);
                            }
                        }


                        if (depth < stopAfterDepth - 1 && result.length <= 30) {
                            let countDepth1s = 0;
                            let nonDepth1 = 0;
                            for (const res of seed) {
                                if (depth1.has(res)) countDepth1s++; else nonDepth1++;
                            }

                            if (countDepth1s - (2 * nonDepth1) <= 2) depthLists[depth + 1].add([...seed].sort().join('='));
                        }
                        seed.pop();
                    }
                    processedSeeds++;
                }
            }

            const seedIterator = depthLists[depth].values();
            const workers = Array(parallelBots).fill().map(() => worker(seedIterator));
            await Promise.all(workers); // wait for all workers to finish


            console.log("\nDepth:", depth + 1, "completed!", "\nTime:", (Date.now() - startTime) / 1000, "s\nSeeds:", totalSeeds, "->", depthLists[depth + 1].size, "\nElements:", encounteredElements.size);
        }

        clearInterval(interval);
        await browser.close();
        console.log("%cDone!", 'background: red; color: white');
    })();


    function addToEncounteredElements(element, seed) {
        let setFlag = false;
        if (encounteredElements.has(element)) {
            const ee = encounteredElements.get(element);
            if (ee[0].length === seed.length) {
                ee.push([...seed].sort());
            } else if (ee[0].length > seed.length) setFlag = true;
        } else setFlag = true;
        if (setFlag) {
            encounteredElements.set(element, [[...seed].sort()]);
            if (encounteredElements.size % printProgressEvery.elements === 0) printSeedProgress();

            if (printLineageCondition(element)) console.log('\n', ...makeLineage(encounteredElements.get(element), element + " Lineage"));
        }
    }


    function printSeedProgress() {
        console.log('Depth', depth + 1, '-', processedSeeds, "/", totalSeeds, "seeds processed -", Math.round(processedSeeds / totalSeeds * 100 * 100) / 100, "%");
    }


    async function combine(first, second) {
        if (first.length > 30 || second.length > 30) return "Nothing";
        const waitingDelay = Math.max(0, combineTime - (Date.now() - lastCombination));
        lastCombination = Date.now() + waitingDelay;
        await delay(waitingDelay);

        // if recipe suddenly exists after awaiting delay
        const recExists = recipeExists(first, second);
        if (recExists) {
            lastCombination -= combineTime;
            return recExists;
        }

        for (let attempt = 0; attempt < combineRetries; attempt++) {
            const url = `/api/infinite-craft/pair?first=${encodeURIComponent(first)}&second=${encodeURIComponent(second)}`;
            let response;

            try {
                response = await page.evaluate(async (url) => {
                    const res = await fetch(url);
                    if (!res.ok) {
                        if (res.status === 429) {
                            return {ratelimited: true};
                        } else throw new Error(`Failed with status: ${res.status}`);
                    } else return res.json();
                }, url);
            } catch (error) {
                if (attempt < combineRetries - 1) {  // if it is NOT the final attempt
                    lastCombination += combineTime;
                    continue;
                }
            }

            if (response?.ratelimited) {
                throw new Error("rate limited!")
            }

            const result = response?.result || "Nothing";
            const combString = `${first}=${second}`;
            recipesIng[combString] = result;

            if (!recipesRes.has(result)) recipesRes.set(result, new Set());
            recipesRes.get(result).add(combString);

            if (combineLogs) console.log(`Combine: ${first} + ${second} = ${result}`);
            return result;
        }
    }


    function allCombinations(array) {
        const combinations = [];
        for (let i = 0; i < array.length; i++) {
            for (let j = 0; j <= i; j++) {
                combinations.push([array[i], array[j]].sort());
            }
        }
        return combinations;
    }


    async function processCombinations(combinations) {
        const results = new Set();
        combinations = combinations.map(([first, second]) => [icCase(first), icCase(second)].sort());

        for (const [first, second] of combinations) {
            let result = recipeExists(first, second);
            if (!result) {
                result = await combine(first, second);
            }
            if (result && result !== "Nothing") {
                results.add(result);
            }
        }

        return results;
    }
})();


function saveRecipes(recipes) {
    fs.writeFileSync("recipes.json", JSON.stringify(recipesIng, null, 4), "utf8");
    // console.log("Recipes saved to recipes.json");
}

function loadRecipes() {
    if (fs.existsSync("recipes.json")) {
        const data = fs.readFileSync("recipes.json", "utf8");
        return JSON.parse(data);
    } else {
        console.error("No recipes.json file found. Please make one.");
    }
}

setInterval(() => saveRecipes(recipesIng), 1 * 60 * 1000);


function recipeExists(first, second) {
    // first and second have to already be icCased and sorted!
    // [first, second] = [icCase(first), icCase(second)].sort();
    const combString = `${first}=${second}`;
    const result = recipesIng[combString];

    if (result) {
        if (!recipesRes.has(result)) recipesRes.set(result, new Set());
        recipesRes.get(result).add(combString);

        return result;
    }
}


function makeLineage(lineages, element) {
    // generate a valid lineage using just the results
    return [lineages[0].length, `- ${element}:`, lineages.map(lineage => generateLineageFromResults(lineage).map(recipe => `\n${recipe[0]} + ${recipe[1]} = ${recipe[2]}`).join('')).join('\n ...')];
}

function generateLineageFromResults(results, allowBaseElements = true) {
    const toUse = new Set(allowBaseElements ? fullBaseSet : baseBaseElements);
    const toAdd = new Set([...results])
    let recipe = [];

    // required to make different cases work THIS WAS A PAIN TO CODE
    const correctCaseMap = new Map();

    while (toAdd.size > 0) {
        let addedSmth = false
        for (const result of toAdd) {
            const validRecipe = (precomputedRecipesRes.get(result) || Array.from(recipesRes.get(result)).map(x => x.split('=')))
                .find(([first, second]) => toUse.has(first) && toUse.has(second) && (!correctCaseMap.has(first) || correctCaseMap.get(first) !== result) && (!correctCaseMap.has(second) || correctCaseMap.get(second) !== result));

            if (validRecipe) {
                recipe.push([...validRecipe.map(x => correctCaseMap.has(x) ? correctCaseMap.get(x) : x), result]);
                const icResult = icCase(result);
                toUse.add(icResult);
                correctCaseMap.set(icResult, result);
                toAdd.delete(result);
                addedSmth = true;
            }
        }
        if (!addedSmth) return [...recipe, ...["could", "not generate", "Lineage"]];
    }
    return recipe;
}


function icCase(input) {
    let result = '';
    const len = input.length;

    for (let i = 0; i < len; i++) {
        const char = input[i];
        result += (i === 0 || input[i - 1] === ' ') ? char.toUpperCase() : char.toLowerCase()
    }

    return result;
};


const repl = require('repl');
const {type} = require("os");

// Create a REPL instance
const replServer = repl.start({prompt: '> '});

// Define commands
replServer.context.help = () => console.log(replServer.context);
replServer.context.clearNothings = (onlyDead, onlyFromCurrentRun) => {
    if (onlyDead === undefined || onlyFromCurrentRun === undefined)
        return "function requires 2 Boolean values (onlyDead, onlyFromCurrentRun)";

    let count = 0;
    for (const key in recipesIng) {
        if (onlyFromCurrentRun && !key.split('=').every(x => !encounteredElements.has(x))) continue;
        if (recipesIng[key] === "Nothing" && (!onlyDead || key.split('=').some(x => x !== x.icCase()))) {
            delete recipesIng[key]; // Remove the entry
            count++;
        }
    }
    return `Removed ${count} recipes with 'Nothing'`;
}
replServer.context.lineage = (element) => {
    element = icCase(element);
    const message = [];
    for (const [elem, seed] of encounteredElements.entries()) {
        if (icCase(elem) === element) {
            message.push(makeLineage(seed, elem + " Lineage").join(" "));
        }
    }
    return message.length > 0 ? message.join('\n\n') : "This Element has not been made...";
}

replServer.context.lineagesFile = () => {
    let content = [];

    content.push(generateLineageFromResults(baseElements, false).map(recipe => `${recipe[0]} + ${recipe[1]} = ${recipe[2]}`).join('\n') + `  // ${baseElements.length}`);

    const genCounts = Array(depth + 1).fill(0);
    encounteredElements.forEach(seeds => genCounts[seeds[0].length - 1]++);
    let runningTotal = 0;
    content.push(genCounts.map((count, index) => {
        runningTotal += genCounts[index];
        return `Gen ${index + 1} - ${count} Elements -> ${runningTotal} Total Elements`;
    }).join('\n'));


    console.time("Generate Lineages File");
    for (const [result, recipes] of recipesRes.entries()) {
        precomputedRecipesRes.set(result, Array.from(recipes).map(x => x.split('=')));
    }

    content.push(Array.from(encounteredElements.entries())
        .map(([element, lineage]) => makeLineage(lineage, element).join(' '))
        .join('\n\n'));

    precomputedRecipesRes.clear();
    console.timeEnd("Generate Lineages File");


    content.push(JSON.stringify(Object.fromEntries(Array.from(encounteredElements, ([element, seed]) => [element, seed[0].length])), null, 2));


    const filename = `${baseElements[baseElements.length - 1]} Seed - ${Math.floor(processedSeeds / totalSeeds * 100)}% gen ${depth + 1}.txt`;
    fs.writeFileSync(`./${filename}`, content.join('\n\n\n\n'), "utf8");
    return `File saved: ${filename}`;
};


// prints all elements that have been made in the current run and that haven't been used in any recipe
replServer.context.likelyDead = () => {
    const candidatesSet = new Set(encounteredElements.keys().filter(x => x !== icCase(x)));
    console.log(candidatesSet.size);

    const recipeResSet = new Set();
    for (const [element, recipes] of recipesRes) {
        if (element === "Nothing") continue;
        for (const recipe of recipes) {
            recipe.split('=', 2).forEach(x => recipeResSet.add(x));
        }
    }
    for (const element of candidatesSet) {
        if (recipeResSet.has(icCase(element))) candidatesSet.delete(element);
    }
    fs.writeFileSync(`./tempOutput.txt`, [...candidatesSet].join('\n'), "utf8");
    return `File saved - ${candidatesSet.size} Elements`;
}

replServer.context.currentElements = () => {
    fs.writeFileSync(`./tempOutput.txt`, Array.from(encounteredElements.keys()).join('\n'), "utf8");
    return `File saved - ${encounteredElements.size()} Elements`;
};


// Handle process cleanup on exit or stop
function onExit() {
    saveRecipes(recipesIng);
}

// Handle the "beforeExit" event
process.on('beforeExit', () => {
    onExit();
});

// Listen for termination signals (for Ctrl+C)
process.on('SIGINT', () => {
    onExit();
    process.exit(0); // Exit gracefully
});

// Handle process exit (e.g., from Shift+F5 in VS Code)
process.on('exit', (code) => {
    onExit();
});