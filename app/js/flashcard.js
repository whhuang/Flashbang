/* 
    functions must be called in this order bunch:getAll -> updateHTML -> createRefPair -> setCurrentPair -> displayCard
    for that reason createRefPair calls setCurrentPair calls displayCard
*/

const { ipcRenderer } = require("electron");

let settings; //all study settings
let bunchSettings = {}; //all bunch settings

var answerShown = false,
    studyComplete = false;
var pairs; //pairs is all pairs in bunch, current pair is the one currently being displayed
var menuToggled = false;
let pairsRef = []; //array of references to each pair
let flaggedPairs = []; //array of references to each flagged pair (experimental-use only)

const url = document.location.href;
const id = url.split("?")[1].split("=")[1].replaceAll("%20", " "); //gets the id of bunch from query string

let inResetMenu = false;

//#region Event Handlers
/* -------------------------------------------------------------------------- */
/*                               Event Handlers                               */
/* -------------------------------------------------------------------------- */

window.onload = () => {
    //requests pairs data from main
    ipcRenderer.send("globalSettings:getAll");
    //requests studySettings data from main
    //NOTE Settings must be gotten before pairs
    ipcRenderer.send("studySettings:getAll");
    //sets lastUsed to current time
    ipcRenderer.send("bunch:set", id, {
        key: "lastUsed",
        value: new Date(),
    });
    //requests bunch data
    ipcRenderer.send("bunch:getAll", id);
};

//edit button
document.getElementById("edit-bunch-btn").addEventListener("click", () => {
    document
        .getElementById("edit-bunch-btn")
        .setAttribute("href", `newbunch.html?id=${id}&from=flashcard`);
});

//options button
document.getElementById("options-btn").addEventListener("click", toggleMenu);

function toggleMenu() {
    if (!menuToggled) {
        document.getElementById("options-menu").classList.remove("hide");
    } else {
        document.getElementById("options-menu").classList.add("hide");
    }
    menuToggled = !menuToggled;
}

document.body.addEventListener("click", (e) => {
    if (
        !document.getElementById("options-menu").contains(e.target) &&
        !document.getElementById("options-btn").contains(e.target)
    ) {
        if (menuToggled) {
            toggleMenu();
        }
    }
});

document.getElementById("back-btn").addEventListener("click", () => {
    window.location.href = `index.html`;
});

//question type
var typeRadios = document.querySelectorAll('input[name="questionType"]');
Array.prototype.forEach.call(typeRadios, (radio) => {
    radio.addEventListener("change", onQuestionTypeChange);
});

function onQuestionTypeChange() {
    ipcRenderer.send("bunch:set", id, {
        key: "questionType",
        value: {
            flashcard: document.getElementById("ask-flashcard").checked,
            typed: document.getElementById("ask-typed").checked,
            test: document.getElementById("ask-test").checked,
        },
    });
    bunchSettings.questionType = {
        //TODO should be updated w get to main
        flashcard: document.getElementById("ask-flashcard").checked,
        typed: document.getElementById("ask-typed").checked,
        test: document.getElementById("ask-test").checked,
    };

    updateMenu();
    updateHTML();
    updateRemainingText();
    if (
        bunchSettings.questionType.flashcard ||
        bunchSettings.questionType.typed
    ) {
        createPairsRef();
    }
}

document.getElementById("say-prompt").addEventListener("change", () => {
    ipcRenderer.send("bunch:set", id, {
        key: "sayPrompt",
        value: document.getElementById("say-prompt").checked,
    });
    // bunchSettings.sayPrompt = ipcRenderer.send("bunch:get", id, "sayPrompt");
    //TODO do this with get request, the above does not work for some reason
    bunchSettings.sayPrompt = document.getElementById("say-prompt").checked;
});

document.getElementById("say-answer").addEventListener("change", () => {
    ipcRenderer.send("bunch:set", id, {
        key: "sayAnswer",
        value: document.getElementById("say-answer").checked,
    });
    // bunchSettings.sayAnswer = ipcRenderer.send("bunch:get", id, "sayAnswer");
    //TODO do this with get request, the above does not work for some reason
    bunchSettings.sayAnswer = document.getElementById("say-answer").checked;
});



document.getElementById("hide-para-text").addEventListener("change", () => {
    ipcRenderer.send("bunch:set", id, {
        key: "hideParaText",
        value: document.getElementById("hide-para-text").checked,
    });
    //TODO do this with get request,
    bunchSettings.hideParaText =
        document.getElementById("hide-para-text").checked;

    displayCard();
});

const testToggleBtns = document.getElementsByClassName("test-toggle");
for (btn of testToggleBtns) {
    btn.addEventListener("click", generateTest);
}

//TODO change to only on down
window.addEventListener("keydown", keyListener);
function keyListener(e) {
    if (!e.repeat) {
        //makes it on key initially pressed down instead of while key down
        e = e || window.e; //capture the e, and ensure we have an e
        var key = e.key; //find the key that was pressed
        if (
            key === "Escape" ||
            (!inResetMenu && studyComplete && (key === " " || key === "Enter"))
        ) {
            window.location.href = "index.html";
            return;
        } else if (inResetMenu && key === " ") {
            exitResetMenu();
        } else {
            answerManager(e);
        }
    }
}

//-----------Settings Stuff------------
ipcRenderer.on("globalSettings:getAll", (e, settingsIn) => {
    settings = settingsIn;
});

// ------------Pairs Stuff-------------
ipcRenderer.on("bunch:getAll", (e, bunch) => {
    pairs = JSON.parse(JSON.stringify(bunch.pairs)); //deep copy

    bunchSettings.promptLang = bunch.promptLang;
    bunchSettings.answerLang = bunch.answerLang;

    bunchSettings.questionType = bunch.questionType;

    bunchSettings.sayPrompt = bunch.sayPrompt;
    bunchSettings.sayAnswer = bunch.sayAnswer;

    bunchSettings.hideParaText = bunch.hideParaText;

    studyComplete = bunch.complete;

    updateMenu();

    updateHTML();

    if (
        bunchSettings.questionType.typed ||
        bunchSettings.questionType.flashcard
    ) {
        createPairsRef();
    }
});

function setPairs() {
    ipcRenderer.send("bunch:set", id, {
        key: "pairs",
        value: pairs,
    });
}

function setComplete() {
    ipcRenderer.send("bunch:set", id, {
        key: "complete",
        value: studyComplete,
    });
}

function updateMenu() {
    if (bunchSettings.questionType.typed) {
        ipcRenderer.send("updateMenu", "study-typed");
    } else {
        ipcRenderer.send("updateMenu", "standard");
    }
}
//#endregion

//#region Bunch Management
/* -------------------------------------------------------------------------- */
/*                              Bunch Management                              */
/* -------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------------------------------------- */

// Spaced-repetition algorithm that introduces new terms very slowly.
// Save array of terms with the following fields:
// - term
// - times seen
// - total right
// - last n right
// 
// +---------------+--------------+--------------------------------------+
// | percent wrong | last n right | when to show word again (in n cards) |
// +---------------+--------------+--------------------------------------+
// | >50%          | 0            | 0                                    |
// +---------------+--------------+--------------------------------------+
// | >50%          | 1            | 1                                    |
// +---------------+--------------+--------------------------------------+
// | >50%          | 2            | 2                                    |
// +---------------+--------------+--------------------------------------+
// | >50%          | 3            | 4                                    |
// +---------------+--------------+--------------------------------------+
// | >50%          | 4+           | 8                                    |
// +---------------+--------------+--------------------------------------+
// | 0< <50%       | n (<7)       | 2^n                                  |
// +---------------+--------------+--------------------------------------+
// | 0< <50%       | n (>=7)      | (n - 6)*100 (deprioritized)          |
// +---------------+--------------+--------------------------------------+
// | 0%            | 0 - 1        | 0 (deprioritized)                    |
// +---------------+--------------+--------------------------------------+
// | 0%            | n (>1)       | (n - 1) * 100 (deprioritized)        |
// +---------------+--------------+--------------------------------------+
//
// Each term has a "score", which is index + when to show word again value.
// term weight = 1 / score
// randomly choose term using weights
// TODO: add reset button to reset stored values

function createPairsRef() {
    if (!Array.isArray(pairsRef) || pairsRef.length === 0) {
        pairsRef = [];
        for (x = 0; x < pairs.length; x++) {
            pairsRef.push({
                'prompt': pairs[x]['prompt'],
                'answer': pairs[x]['answer'],
                'timesSeen': 0,
                'totalRight': 0,
                'lastNRight': 0,
                'scheduledNext': 0,
            });
        }
    }

    setCurrentPair();
    updateRemainingText();
}

function setCurrentPair() {
    let assigned = false;
    for (x = 0; x < flaggedPairs.length; x++) {
        if (flaggedPairs[x]['scheduledNext'] === 0) {
            if (!assigned) {
                currentPair = flaggedPairs[x];
                assigned = true;
                console.log(assigned);
            }
        } else {
            flaggedPairs[x]['scheduledNext'] -= 1;
        }
    }

    console.log(flaggedPairs);

    // Grab from the non-flagged pile if no flagged terms are "ready"
    if (!assigned) {
        currentPair = pairsRef.reduce((minItem, currentItem) => 
            currentItem.scheduledNext < minItem.scheduledNext ? currentItem : minItem
        );
    }

    displayCard();
}

function generateCalls() {
    setPairs();
    createPairsRef();
}

function handleAnswer(correct) {
    currentPair['timesSeen'] += 1;
    if (correct) {
        currentPair['totalRight'] += 1;
        currentPair['lastNRight'] += 1;
    } else {
        currentPair['lastNRight'] = 0
        const index = flaggedPairs.indexOf(currentPair);
        if (index === -1) {
            // Pop pair from normal pairsRef and push to flaggedPairs
            flaggedPairs.push(currentPair);
            const pairsRefIndex = pairsRef.indexOf(currentPair);
            pairsRef.splice(pairsRefIndex, 1);
        }
    }

    // Implement the above algorithm
    timesSeen = currentPair['timesSeen'];
    totalRight = currentPair['totalRight'];
    lastNRight = currentPair['lastNRight'];
    percentWrong = (timesSeen - totalRight) / timesSeen;

    if (percentWrong > 0.5) {
        switch (lastNRight) {
            case 0:
                score = 0;
                break;
            case 1:
                score = 1;
                break;
            case 2:
                score = 2;
                break;
            case 3:
                score = 4;
                break;
            default:
                score = 8;
                break;
        }
    } else if (percentWrong > 0) {
        if (lastNRight < 7) {
            score = 2 ** lastNRight;
        } else {
            // Put it back in the normal queue
            const index = pairsRef.indexOf(currentPair);
            if (index === -1) {
                // Pop pair from flaggedPairs and push to normal pairsRef
                pairsRef.push(currentPair);
                const flaggedPairsIndex = flaggedPairs.indexOf(currentPair);
                flaggedPairs.splice(flaggedPairsIndex, 1);
            }
        }
    } else {
        score = lastNRight < 2 ? 0 : (lastNRight - 1) * 100;
        // Put it back in the normal queue if needed
        const index = pairsRef.indexOf(currentPair);
        if (index === -1) {
            // Pop pair from flaggedPairs and push to normal pairsRef
            pairsRef.push(currentPair);
            const flaggedPairsIndex = flaggedPairs.indexOf(currentPair);
            flaggedPairs.splice(flaggedPairsIndex, 1);
        }
    }

    currentPair['scheduledNext'] = score
}

function updateCalls(correct) {
    handleAnswer(correct)
}

/* ------------------------------------------------------------------------------------------------------- */


var correctTimeout, incorrectTimeout;
function showAnswer() {
    if (bunchSettings.questionType.flashcard) {
        document.querySelector("#main-separator").classList.remove("hide");
        document.getElementById("answer").classList.remove("hide");
        document.getElementById("bottom-text").innerText =
            "Incorrect: Press 1 \n Correct: Press 2 or Space";
        answerShown = true;
    } else if (bunchSettings.questionType.typed) {
        document.getElementById("answer-input").blur();
        document.getElementById("answer-input").readOnly = true;
        answerShown = true;
        document.getElementById("bottom-text").innerText =
            "Press Enter to Continue";

        let userAnswer = document.getElementById("answer-input").value.trim();
        let answer = currentPair.answer;

        if (typedCorrect(userAnswer, answer)) {
            updateCalls(true);
            if (settings.delayCorrect == 0) {
                resetPage();
            } else {
                styleAnswer(true);
                correctTimeout = setTimeout(
                    resetPage,
                    settings.delayCorrect * 1000
                );
            }
        } else {
            noTimeout = false;
            incorrectTimeout = setTimeout(() => {
                noTimeout = true;
            }, settings.delayIncorrect * 1000);
            styleAnswer(false);
        }
    }
}

function typedCorrect(userAnswer, answer) {
    //if the answer is: "ans1 (1) / ans2 (2)", with all settings we should accept:
    //"ans1 (1) / ans2 (2)", "ans1 / ans2", "ans1 (1)", "ans2 (2)", "ans1", "ans2"

    let answers;
    if (settings.useSlash) {
        answers = answer.split("/");

        for (x = 0; x < answers.length; x++) {
            answers[x] = answers[x].trim();
        }

        if (answers.length > 1) {
            answers.unshift(answer); //appends full answer to position 0
        }
    } else {
        answers = [];
        answers.push(answer);
    }

    let toBeAdded = [];

    if (settings.ignoreParenthesis) {
        const re = /[()（）][^()（）]*[()（）] */g; //removes parenthesis and text btw them
        for (x = 0; x < answers.length; x++) {
            const val = answers[x].replace(re, "").trim();
            if (!answers.includes(val)) {
                toBeAdded.push(val);
            }
        }
    }

    answers = answers.concat(toBeAdded);
    toBeAdded = [];

    if (settings.ignoreCapital) {
        userAnswer = userAnswer.toLowerCase();
        for (x = 0; x < answers.length; x++) {
            const val = answers[x].toLowerCase();
            if (!answers.includes(val)) {
                toBeAdded.push(val);
            }
        }
    }

    answers = answers.concat(toBeAdded);
    toBeAdded = [];

    for (x = 0; x < answers.length; x++) {
        if (userAnswer == answers[x]) {
            return true;
        }
    }
    return false;
}

var noTimeout; //used for incorrect forced delay
function answerManager(e) {
    if (bunchSettings.questionType.flashcard) {
        if (!answerShown) {
            if (e.key === " ") {
                showAnswer();
            }
        } else {
            if (e.key === "2" || e.key === " ") {
                //Answer is right
                updateCalls(true);
                resetPage(); //this must stay inside if bc otherwise resets on any key
            } else if (e.key === "1") {
                //answer is wrong
                updateCalls(false);
                resetPage(); //this must stay inside if bc otherwise resets on any key
            }
        }
    } else if (bunchSettings.questionType.typed) {
        if (!answerShown) {
            if (e.key === "Enter") {
                showAnswer();
            }
        } else {
            if (e.key === "Enter" && noTimeout) {
                clearTimeout(correctTimeout);
                handleAnswer(false);
                resetPage();
            } else if (
                (e.metaKey && e.key.toLowerCase() === "d") ||
                (e.ctrlKey && e.key.toLowerCase() === "d")
            ) {
                iWasRight();
            }
        }
    }
}

function iWasRight() {
    clearTimeout(incorrectTimeout);
    noTimeout = true;
    handleAnswer(true);
    resetPage();
}

//#endregion

//#region HTML Management
/* -------------------------------------------------------------------------- */
/*                               HTML Management                              */
/* -------------------------------------------------------------------------- */

function updateHTML() {
    /*updates all html that depends on bunch content/settings */
    updateOptionsMenu();

    document.getElementById("hide-para-text").checked =
        bunchSettings.hideParaText;

    const root = document.querySelector(":root");
    root.style.fontSize = `${settings.studyFontSize}px`;

    if (studyComplete) {
        //study again menu is open bc bunch is complete
        inResetMenu = true;
        var fcc = document.getElementById("main-container");
        fcc.innerHTML = `<h2 id="end-dialogue">Bunch Complete <br> Press Space to Reset Progress</h2>`;
    } else {
        if (bunchSettings.questionType.flashcard) {
            document.getElementById("main-container").innerHTML = `
            <div id="prompt-container"> 
                <h2 class="" id="prompt"></h2>
            </div>
            <div class="hide ${
                settings.animateStudy ? "animate" : ""
            }" id="main-separator"></div>
            <h2 class="hide ${
                settings.animateStudy ? "animate" : ""
            }" id="answer"></h2>`;

            document.getElementById("main-container").style.paddingBottom =
                "10vh";

            changeDisplayTypedAndFlashcard();
            initBottomContainer();
        } else if (bunchSettings.questionType.typed) {
            document.getElementById("main-container").innerHTML = `
            <div id="prompt-container"> 
                <h2 id="prompt">Lorem</h2>
            </div>
            <div id="typed-container">
                    <input type="text" id="answer-input"/>
                    <span id="answer-input-span"></span>
                    <div class="hide" id="status-block">&#10004</div>
                    <h2 class="hide typed-answer" id="answer">Lorem</h2>
                    <div class="hide" id="iwr-btn-container">
                        <button id="iwr-btn">I was right</button>
                    </div>
            </div>`;

            document.getElementById("main-container").style.paddingBottom =
                "5vh";

            document
                .getElementById("iwr-btn")
                .addEventListener("click", iWasRight);

            document
                .getElementById("answer-input")
                .addEventListener("input", updateInputLength);

            changeDisplayTypedAndFlashcard();
            initBottomContainer();
        } else if (bunchSettings.questionType.test) {
            //checking boxes

            //html chnages
            document
                .getElementById("main-container")
                .classList.remove("flashcard-main-container");
            document
                .getElementById("main-container")
                .classList.add("test-main-container");

            document
                .getElementById("bottom-container-container")
                .classList.add("undisplay");
            document
                .getElementById("edit-bunch-btn")
                .classList.add("undisplay");

            document.getElementById("say-options").classList.add("undisplay");
            document
                .getElementById("format-options")
                .classList.add("undisplay");

            document
                .getElementById("test-config-options")
                .classList.remove("undisplay");

            document.getElementById("num-test-questions").value =
                pairs.length > 2 ? pairs.length : 3;

            document
                .getElementById("num-test-questions")
                .addEventListener("change", () => {
                    let val;
                    val = parseInt(
                        document.getElementById("num-test-questions").value
                    );
                    if (isNaN(val)) {
                        val = pairs.length > 2 ? pairs.length : 3;
                    } else if (val < 3) {
                        val = 3;
                    } else if (val > pairs.length) {
                        val = pairs.length > 2 ? pairs.length : 3;
                    }

                    document.getElementById("num-test-questions").value = val;
                    generateTest();
                });

            generateTest();
        }
    }
}

function updateInputLength() {
    const span = document.getElementById("answer-input-span");
    const inputContainer = document.getElementById("typed-container");
    span.innerHTML = document
        .getElementById("answer-input")
        .value.replace(/\s/g, "&nbsp;");
    inputContainer.style.width = span.offsetWidth + "px";
}

function updateOptionsMenu() {
    document.getElementById("ask-flashcard").checked =
        bunchSettings.questionType.flashcard;
    document.getElementById("ask-typed").checked =
        bunchSettings.questionType.typed;
    document.getElementById("ask-test").checked =
        bunchSettings.questionType.test;

    document.getElementById("say-prompt").checked = bunchSettings.sayPrompt;
    document.getElementById("say-answer").checked = bunchSettings.sayAnswer;

    document.getElementById("MC-test-toggle").checked = true;
    document.getElementById("typed-test-toggle").checked = true;
    document.getElementById("TF-test-toggle").checked = true;
}

function initBottomContainer() {
    if (bunchSettings.questionType.flashcard) {
        document.getElementById("bottom-container").innerHTML = `
            <p ${
                settings.showRemaining ? "" : 'class="undisplay"'
            }id="remaining-text"></p>

            <p ${
                settings.showInfo ? "" : 'class="undisplay"'
            } id="bottom-text">Press Space to Reveal Answer</p>`;
    } else if (bunchSettings.questionType.typed) {
        document.getElementById("bottom-container").innerHTML = `
            <p ${
                settings.showRemaining ? "" : 'class="undisplay"'
            }id="remaining-text"></p>

            <p ${
                settings.showInfo ? "" : 'class="undisplay"'
            } id="bottom-text">Press Enter to Answer</p>`;
    }
}

function changeDisplayTypedAndFlashcard() {
    document.getElementById("edit-bunch-btn").classList.remove("undisplay");

    document
        .getElementById("bottom-container-container")
        .classList.remove("undisplay");

    document
        .getElementById("main-container")
        .classList.add("flashcard-main-container");
    document
        .getElementById("main-container")
        .classList.remove("test-main-container");

    document.getElementById("say-options").classList.remove("undisplay");
    document.getElementById("format-options").classList.remove("undisplay");

    document.getElementById("test-config-options").classList.add("undisplay");
}

function genTestMC(pair, index) {
    let questionPrompt, questionAnswer, choiceType;
    if (document.getElementById("standard-test").checked) {
        questionPrompt = pair.prompt;
        questionAnswer = pair.answer;
        choiceType = "answer";
    } else if (document.getElementById("reversed-test").checked) {
        questionPrompt = pair.answer;
        questionAnswer = pair.prompt;
        choiceType = "prompt";
    } else if (document.getElementById("both-test").checked) {
        if (Math.floor(Math.random() * 2) == 0) {
            questionPrompt = pair.prompt;
            questionAnswer = pair.answer;
            choiceType = "answer";
        } else {
            questionPrompt = pair.answer;
            questionAnswer = pair.prompt;
            choiceType = "prompt";
        }
    }

    //at least THREE pairs must exist to do mc
    let randIndex1 = Math.floor(Math.random() * pairs.length);
    while (randIndex1 == index) {
        randIndex1 = Math.floor(Math.random() * pairs.length);
    }
    let randIndex2 = Math.floor(Math.random() * pairs.length);
    while (randIndex2 == index || randIndex2 == randIndex1) {
        randIndex2 = Math.floor(Math.random() * pairs.length);
    }

    let choice0, choice1, choice2;
    let answerIndex = Math.floor(Math.random() * 3);
    switch (answerIndex) {
        case 0:
            choice0 = questionAnswer;
            choice1 = pairs[randIndex1][choiceType];
            choice2 = pairs[randIndex2][choiceType];
            break;
        case 1:
            choice0 = pairs[randIndex1][choiceType];
            choice1 = questionAnswer;
            choice2 = pairs[randIndex2][choiceType];
            break;
        case 2:
            choice0 = pairs[randIndex1][choiceType];
            choice1 = pairs[randIndex2][choiceType];
            choice2 = questionAnswer;
            break;
    }

    const html = `<div class="test-MC" answer="${answerIndex}" selected=-1>
    <div class="test-MC-prompt">${questionPrompt}</div>
    <div class="test-MC-choice-container">
        <button class="test-MC-choice" num=0><div class="test-MC-choice-text">${choice0}</div><div class="correct-indicator undisplay">&#10004;</div></button>
        <button class="test-MC-choice" num=1><div class="test-MC-choice-text">${choice1}</div><div class="correct-indicator undisplay">&#10004;</div></button>
        <button class="test-MC-choice" num=2><div class="test-MC-choice-text">${choice2}</div><div class="correct-indicator undisplay">&#10004;</div></button>
        <div class="incorrect-indicator-container">
            <svg class="incorrect-indicator undisplay" width="24px" height="24px" viewBox="0 0 24 24" version="1.2" baseProfile="tiny" xmlns="http://www.w3.org/2000/svg"><path d="M17.414 6.586c-.78-.781-2.048-.781-2.828 0l-2.586 2.586-2.586-2.586c-.78-.781-2.048-.781-2.828 0-.781.781-.781 2.047 0 2.828l2.585 2.586-2.585 2.586c-.781.781-.781 2.047 0 2.828.39.391.902.586 1.414.586s1.024-.195 1.414-.586l2.586-2.586 2.586 2.586c.39.391.902.586 1.414.586s1.024-.195 1.414-.586c.781-.781.781-2.047 0-2.828l-2.585-2.586 2.585-2.586c.781-.781.781-2.047 0-2.828z"/></svg>
        </div>
    </div>
</div>`;
    return html;
}

function genTestTyped(pair) {
    let questionPrompt, questionAnswer;
    if (document.getElementById("standard-test").checked) {
        questionPrompt = pair.prompt;
        questionAnswer = pair.answer;
    } else if (document.getElementById("reversed-test").checked) {
        questionPrompt = pair.answer;
        questionAnswer = pair.prompt;
    } else if (document.getElementById("both-test").checked) {
        if (Math.floor(Math.random() * 2) == 0) {
            questionPrompt = pair.prompt;
            questionAnswer = pair.answer;
        } else {
            questionPrompt = pair.answer;
            questionAnswer = pair.prompt;
        }
    }

    const html = `<div class="test-typed" answer="${questionAnswer}">
    <div class="test-typed-prompt">${questionPrompt}</div>
    <div class="answer-container-test-typed">
        <input type="text" class="test-typed-answer" />
        <div class="test-typed-correct-answer undisplay">${questionAnswer}</div>
    </div>

    <div class="incorrect-indicator-container typed-correct-indicator-conatiner">
        <svg class="incorrect-indicator undisplay" width="24px" height="24px" viewBox="0 0 24 24" version="1.2" baseProfile="tiny" xmlns="http://www.w3.org/2000/svg"><path d="M17.414 6.586c-.78-.781-2.048-.781-2.828 0l-2.586 2.586-2.586-2.586c-.78-.781-2.048-.781-2.828 0-.781.781-.781 2.047 0 2.828l2.585 2.586-2.585 2.586c-.781.781-.781 2.047 0 2.828.39.391.902.586 1.414.586s1.024-.195 1.414-.586l2.586-2.586 2.586 2.586c.39.391.902.586 1.414.586s1.024-.195 1.414-.586c.781-.781.781-2.047 0-2.828l-2.585-2.586 2.585-2.586c.781-.781.781-2.047 0-2.828z"/></svg>
    </div>
</div>`;
    return html;
}

function genTestTF(pair, index) {
    //NEED AT LEAST TWO PAIRS FOR TF Questions
    let questionPrompt, questionAnswer, reversed;
    if (document.getElementById("standard-test").checked) {
        questionPrompt = pair.prompt;
        questionAnswer = pair.answer;
    } else if (document.getElementById("reversed-test").checked) {
        questionPrompt = pair.answer;
        questionAnswer = pair.prompt;
        reversed = true;
    } else if (document.getElementById("both-test").checked) {
        if (Math.floor(Math.random() * 2) == 0) {
            questionPrompt = pair.prompt;
            questionAnswer = pair.answer;
        } else {
            questionPrompt = pair.answer;
            questionAnswer = pair.prompt;
            reversed = true;
        }
    }

    const isTrue = Math.floor(Math.random() * 2) == 0; //determines if true or false
    if (isTrue) {
        const html = `
        <div class="test-TF" answer="true" state="true">
            <div class="test-TF-prompt">${questionPrompt}</div>
            <button class="test-TF-button">=</button>
            <div class="test-TF-answer">${questionAnswer}</div>

            <div class="incorrect-indicator-container">
                <svg class="incorrect-indicator undisplay" width="24px" height="24px" viewBox="0 0 24 24" version="1.2" baseProfile="tiny" xmlns="http://www.w3.org/2000/svg"><path d="M17.414 6.586c-.78-.781-2.048-.781-2.828 0l-2.586 2.586-2.586-2.586c-.78-.781-2.048-.781-2.828 0-.781.781-.781 2.047 0 2.828l2.585 2.586-2.585 2.586c-.781.781-.781 2.047 0 2.828.39.391.902.586 1.414.586s1.024-.195 1.414-.586l2.586-2.586 2.586 2.586c.39.391.902.586 1.414.586s1.024-.195 1.414-.586c.781-.781.781-2.047 0-2.828l-2.585-2.586 2.585-2.586c.781-.781.781-2.047 0-2.828z"/></svg>
            </div>
        </div>`;
        return html;
    } else {
        let indexDif = Math.floor(Math.random() * pairs.length); //determines other pair
        while (index == indexDif) {
            indexDif = Math.floor(Math.random() * pairs.length);
        }
        const randPrompt = Math.floor(Math.random() * 2) == 0; //determines if prompt is dif or answer is dif
        if (randPrompt) {
            const html = `
                <div class="test-TF" answer="false" state="true">
                    <div class="test-TF-prompt">${
                        reversed
                            ? pairs[indexDif].answer
                            : pairs[indexDif].prompt
                    }</div>
                    <button class="test-TF-button">=</button>
                    <div class="test-TF-answer">${questionAnswer}</div>

                    <div class="incorrect-indicator-container">
                        <svg class="incorrect-indicator undisplay" width="24px" height="24px" viewBox="0 0 24 24" version="1.2" baseProfile="tiny" xmlns="http://www.w3.org/2000/svg"><path d="M17.414 6.586c-.78-.781-2.048-.781-2.828 0l-2.586 2.586-2.586-2.586c-.78-.781-2.048-.781-2.828 0-.781.781-.781 2.047 0 2.828l2.585 2.586-2.585 2.586c-.781.781-.781 2.047 0 2.828.39.391.902.586 1.414.586s1.024-.195 1.414-.586l2.586-2.586 2.586 2.586c.39.391.902.586 1.414.586s1.024-.195 1.414-.586c.781-.781.781-2.047 0-2.828l-2.585-2.586 2.585-2.586c.781-.781.781-2.047 0-2.828z"/></svg>
                    </div>
                </div>`;
            return html;
        } else {
            const html = `
                <div class="test-TF" answer="false" state="true">
                    <div class="test-TF-prompt">${questionPrompt}</div>
                    <button class="test-TF-button">=</button>
                    <div class="test-TF-answer">${
                        reversed
                            ? pairs[indexDif].prompt
                            : pairs[indexDif].answer
                    }</div>

                    <div class="incorrect-indicator-container">
                        <svg class="incorrect-indicator undisplay" width="24px" height="24px" viewBox="0 0 24 24" version="1.2" baseProfile="tiny" xmlns="http://www.w3.org/2000/svg"><path d="M17.414 6.586c-.78-.781-2.048-.781-2.828 0l-2.586 2.586-2.586-2.586c-.78-.781-2.048-.781-2.828 0-.781.781-.781 2.047 0 2.828l2.585 2.586-2.585 2.586c-.781.781-.781 2.047 0 2.828.39.391.902.586 1.414.586s1.024-.195 1.414-.586l2.586-2.586 2.586 2.586c.39.391.902.586 1.414.586s1.024-.195 1.414-.586c.781-.781.781-2.047 0-2.828l-2.585-2.586 2.585-2.586c.781-.781.781-2.047 0-2.828z"/></svg>
                    </div>
                </div>`;
            return html;
        }
    }
}

function generateTest() {
    let numQuestions = parseInt(
        document.getElementById("num-test-questions").value
    );

    let indecies = [];
    for (x = 0; x < pairs.length; x++) {
        indecies[x] = x;
    }

    var testHTML = `<div class="undisplay" id="test-score-container">
                        <div id="test-score-flex">
                            <div id="score-fraction"></div>
                            <div id="score-percent"></div>
                        </div>
                    </div>`;

    let numMC = 0,
        numTyped = 0,
        numTF = 0;
    let numQuestionTypes = 0;

    if (
        document.getElementById("num-test-questions").value > 2 &&
        pairs.length > 2
    ) {
        if (document.getElementById("MC-test-toggle").checked) {
            numQuestionTypes += 1;
            numMC = 1;
        }
        if (document.getElementById("typed-test-toggle").checked) {
            numQuestionTypes += 1;
            numTyped = 1;
        }
        if (document.getElementById("TF-test-toggle").checked) {
            numQuestionTypes += 1;
            numTF = 1;
        }

        numMC = Math.floor(numQuestions / numQuestionTypes) * numMC;
        numTyped = Math.floor(numQuestions / numQuestionTypes) * numTyped;
        numTF = Math.floor(numQuestions / numQuestionTypes) * numTF;

        //max discrepancy btwn total and sum of num___'s is 2

        for (x = 0; x < 2; x++) {
            if (numMC + numTyped + numTF != numQuestions) {
                //prioritizing MC bc it is first so why not //typed is a bit eh in test bc no iwr
                if (document.getElementById("MC-test-toggle").checked) {
                    numMC += 1;
                } else if (
                    document.getElementById("typed-test-toggle").checked
                ) {
                    numTyped += 1;
                } else if (document.getElementById("TF-test-toggle").checked) {
                    numTF += 1;
                }
            }
        }

        testHTML +=
            numMC > 0 ? `<div class="MC-head">Multiple Choice</div>` : "";
        for (x = 0; x < numMC; x++) {
            let indeciesIndex = Math.floor(Math.random() * indecies.length);
            let index = indecies[indeciesIndex];
            let testGenPair = pairs[index];
            testHTML += genTestMC(testGenPair, index);
            indecies.splice(indeciesIndex, 1);
        }
        testHTML += numTyped > 0 ? `<div class="typed-head">Typed</div>` : "";
        for (x = 0; x < numTyped; x++) {
            let indeciesIndex = Math.floor(Math.random() * indecies.length);
            let index = indecies[indeciesIndex];
            let testGenPair = pairs[index];
            testHTML += genTestTyped(testGenPair);
            indecies.splice(indeciesIndex, 1);
        }
        testHTML += numTF > 0 ? `<div class="TF-head">True / False</div>` : "";
        for (x = 0; x < numTF; x++) {
            let indeciesIndex = Math.floor(Math.random() * indecies.length);
            let index = indecies[indeciesIndex];
            let testGenPair = pairs[index];
            testHTML += genTestTF(testGenPair, index);
            indecies.splice(indeciesIndex, 1);
        }
        testHTML +=
            numQuestionTypes > 0
                ? `<div class="test-separator"></div>
                <button id="test-submit" class="test-bottom-btn">Submit</button>`
                : `<div class="test-error-msg"><h2>Select at least one question type</h2></div>`;
    } else {
        if (pairs.length < 3) {
            testHTML += `<div class="test-error-msg"><h2>Bunch must contain at least 3 pairs for test</h2></div>`;
        }
    }

    document.getElementById("main-container").innerHTML = testHTML;

    if (numQuestionTypes > 0) {
        document.getElementById("test-submit").addEventListener("click", () => {
            window.scrollTo(0, 0);
            checkTest();
            const subBtn = document.getElementById("test-submit");
            const newBtn = document.createElement("button");
            newBtn.innerText = "New Test";
            newBtn.classList.add("test-bottom-btn");
            newBtn.addEventListener("click", () => {
                generateTest();
                window.scrollTo(0, 0);
            });
            subBtn.parentNode.replaceChild(newBtn, subBtn);
        });
    }

    const TFButtons = document.getElementsByClassName("test-TF-button");
    for (button of TFButtons) {
        button.addEventListener("click", (e) => {
            newState =
                "true" != e.target.closest(".test-TF").getAttribute("state");
            e.target.closest(".test-TF").setAttribute("state", newState);
            if (newState) {
                e.target.innerText = "=";
            } else {
                e.target.innerText = "≠";
            }
        });

        button.addEventListener("mouseenter", (e) => {
            e.target.style.background = "var(--btn-hover)";
            e.target.style.cursor = "pointer";
        });

        button.addEventListener("mouseleave", (e) => {
            e.target.style.background = "none";
            e.target.style.cursor = "default";
        });
    }

    const MCButtons = document.getElementsByClassName("test-MC-choice");
    for (button of MCButtons) {
        button.addEventListener("click", (e) => {
            e.target
                .closest(".test-MC")
                .setAttribute(
                    "selected",
                    e.target.closest(".test-MC-choice").getAttribute("num")
                );

            const choices = e.target
                .closest(".test-MC")
                .getElementsByClassName("test-MC-choice");
            for (choice of choices) {
                choice.style.background = "none";
            }
            e.target.closest(".test-MC-choice").style.background =
                "var(--btn-hover)";
        });

        button.addEventListener("mouseenter", (e) => {
            e.target.style.background = "var(--btn-hover)";
            e.target.style.cursor = "pointer";
        });

        button.addEventListener("mouseleave", (e) => {
            if (
                e.target.closest(".test-MC").getAttribute("selected") !=
                e.target.closest(".test-MC-choice").getAttribute("num")
            ) {
                e.target.style.background = "none";
            }
            e.target.style.cursor = "default";
        });
    }
}

function checkTest() {
    const choices = document.getElementsByClassName("test-MC-choice");
    for (choice of choices) {
        //cloning removes event listeners
        let new_choice = choice.cloneNode(true);
        choice.parentNode.replaceChild(new_choice, choice);
    }

    const btns = document.getElementsByClassName("test-TF-button");
    for (btn of btns) {
        //cloning removes event listeners
        let new_btn = btn.cloneNode(true);
        btn.parentNode.replaceChild(new_btn, btn);
    }

    let incorrectCount = 0;

    const MC = document.getElementsByClassName("test-MC");
    for (question of MC) {
        if (
            question.getAttribute("answer") != question.getAttribute("selected")
        ) {
            question
                .querySelector(".incorrect-indicator")
                .classList.remove("undisplay");

            question
                .getElementsByClassName("correct-indicator")
                [question.getAttribute("answer")].classList.remove("undisplay");
            incorrectCount += 1;
        }
    }

    const typed = document.getElementsByClassName("test-typed");
    for (question of typed) {
        const input = question.querySelector(".test-typed-answer");
        if (!typedCorrect(input.value, question.getAttribute("answer"))) {
            question
                .querySelector(".incorrect-indicator")
                .classList.remove("undisplay");

            question.querySelector(".test-typed-answer ").style.textDecoration =
                "line-through 2px";

            question
                .querySelector(".test-typed-correct-answer")
                .classList.remove("undisplay");
            incorrectCount += 1;
        }
    }

    const TF = document.getElementsByClassName("test-TF");
    for (question of TF) {
        if (question.getAttribute("answer") != question.getAttribute("state")) {
            question
                .querySelector(".incorrect-indicator")
                .classList.remove("undisplay");

            incorrectCount += 1;
        }
    }

    const totalQuestions = MC.length + typed.length + TF.length;
    document.getElementById("score-fraction").innerText = `Score: ${
        totalQuestions - incorrectCount
    } / ${totalQuestions}`;
    document.getElementById("score-percent").innerText = `${Math.round(
        ((totalQuestions - incorrectCount) / totalQuestions) * 100
    )}%`;
    document
        .getElementById("test-score-container")
        .classList.remove("undisplay");
}

function displayCard() {
    if (!studyComplete) {
        //this is called from bunch:getAll when studyis complete sometimes. this is to stop it from that
        document.getElementById("prompt").innerText =
            bunchSettings.hideParaText
                ? currentPair.prompt.replace(/\(.*?\)/g, "")
                : currentPair.prompt;
        document.getElementById("answer").innerText = currentPair.answer;

        answerShown = false;
    }
}

function styleAnswer(correct) {
    document.getElementById("answer").classList.remove("hide");
    if (correct) {
        const input = document.getElementById("answer-input");
        // input.style.border = `2px solid ${correctGreen}`;
        const statusBlock = document.getElementById("status-block");
        // statusBlock.style.background = correctGreen;
        statusBlock.innerHTML = "&#10004";
        statusBlock.classList.remove("hide");
    } else {
        if (settings.showIwr) {
            document
                .getElementById("iwr-btn-container")
                .classList.remove("hide");
        }
        const input = document.getElementById("answer-input");
        if (settings.strikeThrough) {
            input.style.textDecoration = `line-through 2px`;
        }
        const statusBlock = document.getElementById("status-block");
        // statusBlock.style.background = incorrectRed;
        statusBlock.innerHTML = "&#10006";
        statusBlock.classList.remove("hide");
        // input.style.border = `2px solid ${incorrectRed}`;
    }
}

function resetHTML() {
    if (bunchSettings.questionType.flashcard) {
        document.querySelector("#main-separator").classList.add("hide");
        document.getElementById("answer").classList.add("hide");
        document.getElementById("bottom-text").innerText =
            "Press Space to Reveal Answer";
    } else if (bunchSettings.questionType.typed) {
        const input = document.getElementById("answer-input");
        input.readOnly = false;
        // input.style.border = `2px solid var(--highlight, #393e41)`;
        input.focus();
        input.value = "";
        updateInputLength(); //must be done after value = ""
        input.style.textDecoration = "none";
        document.getElementById("status-block").classList.add("hide");
        document.getElementById("answer").classList.add("hide");
        document.getElementById("iwr-btn-container").classList.add("hide");
        document.getElementById("bottom-text").innerText =
            "Press Enter to Answer";
    }
}

function studyCompleteHTML() {
    var fcc = document.getElementById("main-container");
    const bottomText = document.getElementById("bottom-text");
    bottomText.innerText = "Press Space or Enter to Return Home";
    fcc.innerHTML = `<h2 id="end-dialogue">Bunch Study Complete!</h2>`;
    document.getElementById("bottom-text").classList.remove("undisplay");
    document.getElementById("options-btn").classList.add("hide");
    document.getElementById("remaining-text").classList.add("undisplay");
}

function updateRemainingText() {
    if (settings.showRemaining && !inResetMenu) {
        let notSeen = 0;
        let learned = 0;
        let learning = flaggedPairs.length;
        for (x = 0; x < pairsRef.length; x++) {
            if (pairsRef[x].scheduledNext === 0) {
                notSeen += 1;
            } else {
                if (pairsRef[x].timesSeen < 2) {
                    learning += 1;
                } else {
                    learned += 1;
                }
            }
        }
        document.getElementById(
            "remaining-text"
        ).innerText = `${learning} learning | ${notSeen} new | ${learned} learned`;
    }
}
//#endregion

//#region Resets
/* -------------------------------------------------------------------------- */
/*                                   Resets                                   */
/* -------------------------------------------------------------------------- */
function exitResetMenu() {
    //if the user wishes to reset progress
    studyComplete = false;
    setComplete();
    inResetMenu = false;
    updateHTML();
    generateCalls(); //generateCalls calls createPairsRef, thus updatehtml must be called before
}

function resetPage() {
    if (pairsRef.length > 0) {
        resetHTML();
        updateRemainingText();
        createPairsRef();
    } else {
        studyCompleteHTML();
        studyComplete = true;
        setComplete();
    }
    setPairs();
}
//#endregion