// Fake / Mock mode?
const fakeMode = false;


// Important variables
let stopController = new AbortController();
let shouldStopGenerating = false;
let shouldStopDownloading = false;
let isGenerating = false;
let isDownloading = false;
let manualMode = false;
let currentAudio = null;
let currentSlideIndex = 0;
let showTextAreaLoading = false;
let downloadVideoMode = false;
let isPaused = true;
let didDownload = false;

let audioDurations = [];
let audioFiles = [];
let imageBlobs = [];
let videoTopic = "";

function resetGlobalVariables() {
  shouldStopGenerating = false;
  stopController = new AbortController();
  isGenerating = false;
  isDownloading = false;
  manualMode = false;
  isPaused = true;
  didDownload = false;
  currentAudio = null;
  currentSlideIndex = 0;
  downloadVideoMode = false;
  showTextAreaLoading = false;
  audioDurations = [];
  audioFiles = [];
  imageBlobs = [];
  videoTopic = "";
}

document.getElementById("deckPrompt").addEventListener("keypress", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    toggleGeneration();
  }
});

window.didStartGenerating = function() {
  manualMode = false;
  isGenerating = true;
  showTextAreaLoading = true;
  document.getElementById("deckPrompt").toggleAttribute("loading", true);
  document.getElementById("prompt-button").toggleAttribute("generating", true);
  document.getElementById("generate").setAttribute("src", "img/stop.svg");
  document.getElementById("generate").setAttribute("alt", "stop");
  document.getElementById("download").toggleAttribute("disabled", true);
  document.getElementById("deckPrompt").toggleAttribute("disabled", true);
  document.getElementById("pause-button").toggleAttribute("disabled", true);
}

window.didStopGenerating = function() {
  document.getElementById("generate").setAttribute("src", "img/new-video.svg");
  document.getElementById("generate").setAttribute("alt", "new-video");
  document.getElementById("prompt-button").toggleAttribute("generating", false);
  document.getElementById("deckPrompt").toggleAttribute("disabled", false);
  document.getElementById("download").toggleAttribute("disabled", false);
  isGenerating = false;
  isPaused = true;
  manualMode = true;
  window.onbeforeunload = function () {
    return true;
  };
  if (Reveal.isLastSlide()) {
    Reveal.slide(0, 0, undefined);
  }
}

window.toggleGeneration = function() {
  if (isGenerating) {
    stopDeckGeneration();
  } else {
    startDeckGeneration();
  }
}

window.didStopPlaying = function() {
  isPaused = true;
  document.getElementById("pause").setAttribute("src", "img/play.svg");
  document.getElementById("pause").setAttribute("alt", "play");
  document.getElementById("pause-button").toggleAttribute("disabled", false);
}

window.didStartPlaying = function() {
  isPaused = false;
  document.getElementById("pause").setAttribute("src", "img/pause.svg");
  document.getElementById("pause").setAttribute("alt", "pause");
  document.getElementById("pause-button").toggleAttribute("disabled", false);
}

window.togglePlaying = function() {
  if (isPaused) {
    didStartPlaying();
    currentAudio?.play();
  } else {
    didStopPlaying();
    currentAudio?.pause();
  }
}

window.startDeckGeneration = async function() {
  if (audioFiles > 0 && !didDownload) {
    const message = "You did not save the video you created. It will be deleted if you generate another without saving it. Are you sure you want to continue?";
    // If cancel, stop.
    if (!confirm(message)) {
      return;
    }
  }
  const prompt = document.getElementById('deckPrompt').value.trim();
  if (prompt === videoTopic) {
    manualMode = true;
    Reveal.initialize({
      transition: 'none',
      controlsTutorial: true,
      controls: true,
      plugins: [ RevealMarkdown, RevealHighlight, RevealNotes ],
      keyboard: true,
    });
    return;
  }
  resetGlobalVariables();
  didStartGenerating();
  if (prompt) {
    try {
      await generateSlideDeckContent(prompt);
    } catch(e) {
      /**
       * @type Error
       */
      const error = e;
      if (error?.message === "Stop generating") {
        didStopGenerating();
      } else {
        alert(`Error: ${error}`);
      }
    }
  } else {
    alert('Please enter a topic for the slide deck.');
  }
}

window.stopDeckGeneration = function() {
  shouldStopGenerating = true;
  stopController.abort(); // Abort ongoing fetch requests
  didStopGenerating();
}

// Function to generate the slide deck content
async function generateSlideDeckContent(subject) {
  videoTopic = subject;

  const slidesContainer = document.querySelector('.slides');
  // Show loading experience
  slidesContainer.innerHTML = '<h1>Generating slides...</h1>';

  const slideContents = fakeMode ? await new Promise((resolve) =>
    setTimeout(() => resolve(fakeSlides()), 3000)
  ) : await getMarkdownSlides(subject);

  slidesContainer.innerHTML = ''; // Clear existing slides

  slideContents.forEach((content, index) => {
    const slide = createSlide(content, index);
    slidesContainer.appendChild(slide);
  });

  playAudioSequentially(getSlideCommentary, subject, slideContents);

  // Initialize Reveal.js
  Reveal.initialize({
    transition: 'none',
    controlsTutorial: false,
    controls: false,
    plugins: [ RevealMarkdown, RevealHighlight, RevealNotes ],
    keyboard: false,
  });

  Reveal.on('ready', event => {
    currentSlideIndex = 0;
  });

  Reveal.on( 'slidechanged', async event => {
    currentSlideIndex = event.indexh;
    if (downloadVideoMode) {
      return;
    }
    const audioPlayers = document.getElementById('audioPlayers').children;
    if (manualMode) {
      if (currentAudio != null) {
        currentAudio.pause();
      }
      currentAudio = audioPlayers[event.indexh];
      if (currentAudio) {
        currentAudio.onended = null;
        currentAudio.currentTime = 0;
        if (!isPaused) {
          currentAudio.play();
        }
      }
    } else {
      // Try to play the next audio - it will retry if needed.
      playNextAudio(audioPlayers[event.indexh]);
    }
  });
}


// Function to create a new slide with markdown content
function createSlide(markdownContent, index) {
  const slide = document.createElement('section');
  slide.className = `slide-${index}`;
  slide.setAttribute('data-transition', 'none');
  slide.setAttribute('data-markdown', '');

  const script = document.createElement('script');
  script.type = 'text/template';
  script.textContent = markdownContent;

  slide.appendChild(script);
  return slide;
}

async function* getSlideCommentary(subject, slides) {
  if (fakeMode) {
    for (let i = 0; i < slides.length; i++) {
      yield slides[i];
    }
    return;
  }

  // Stringify as JSON to make it super clear.
  let slidesForPrompt = `\`\`\`
  {
    "slides": ${JSON.stringify(slides)}
  }
  \`\`\``;
  const stream = await getAPICompletion(scriptPrompt(subject, slidesForPrompt, slides.length));

  const reader = stream.getReader();
  let runningText = "";
  let previousSection = "";

  while (true) {
    if (shouldStopGenerating) throw Error("Stop generating");
    const { done, value } = await reader.read();
    if (done) {
      yield runningText;
      break;
    }

    // Decode the chunk and parse it
    const chunk = new TextDecoder().decode(value);
    const lines = chunk.split(/\n+/).filter((a) => !!a);
    // const lines = fakeStreamedScriptLines();

    let doneThisLoop = false;

    const chunks = [];
    lines.forEach((line) => {
      const parsed = line.split("data: ").slice(1).join("data: ");
      if (parsed === "[DONE]") {
        doneThisLoop = true;
        return;
      }

      try {
        const content = JSON.parse(parsed).choices[0].delta.content;
        chunks.push(content);
      } catch (e) {
        console.error("Failed to parse chunk", chunk, parsed, e);
      }
    });

    // Concatenate the received text
    runningText += chunks.join("");

    // Check for the delimiter (more than three hyphens in a row)
    const sections = runningText.split(/---+/);
    if (sections.length > 1) {
      for (let i = 0; i < sections.length - 1; i++) {
        const section = sections[i];
        if (section !== previousSection) {
          // Yield the section
          yield section;
          console.log("section", section);
          previousSection = section;
        }
      }
      // Start accumulating text for the new section
      runningText = sections[sections.length - 1];
    }

    if (doneThisLoop) {
      yield runningText;
      console.log("runningText", runningText);
      break;
    }
  }
}

async function playAudioSequentially(getSlideCommentary, subject, slideContents) {
  const audioPlayersDom = document.getElementById('audioPlayers');
  audioPlayersDom.innerHTML = "";
  let firstPlayed = false;

  for await (const value of getSlideCommentary(subject, slideContents)) {
    if (shouldStopGenerating) throw new Error("Stop generating");
    await convertTextToSpeech(value)
      .then(({ audioPlayer, audioChunks }) => {
        return { audioPlayer, audioChunks };
      })
      .then((result) => {
        if (shouldStopGenerating) throw new Error("Stop generating");
        if (result.error) {
          throw result.error;
        }

        audioPlayersDom.appendChild(result.audioPlayer);
        audioFiles.push({ name: `audio_${result.index + 1}.mp3`, audioChunks: result.audioChunks });
        return result;
      })
      .catch(error => {
      console.error("Error in convertTextToSpeech:", error);
      return { error };
    });

    if (!firstPlayed) {
      firstPlayed = true;
      playNextAudio(audioPlayersDom.children[0]);
    }
  }
}

function playNextAudio(audio) {
  if (shouldStopGenerating) throw new Error("Stop generating");

  if (audio == null) {
    // Retry
    setTimeout(() => {
      console.log("retrying...")
      if (currentAudio.paused) {
        const audioPlayers = document.getElementById('audioPlayers').children;
        playNextAudio(audioPlayers[currentSlideIndex]);
      }
    }, 500);
    return;
  }

  currentAudio = audio;

  const playAudio = () => {
    if (showTextAreaLoading) {
      showTextAreaLoading = false;
      document.getElementById("deckPrompt").toggleAttribute("loading", false);
    }
    audio.oncanplaythrough = null;
    audio.play();
    if (isPaused) {
      didStartPlaying();
    }
  };

  if (audio.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
    audio.oncanplaythrough = playAudio;
  } else {
    playAudio();
  }

  audio.onended = () => {
    audioDurations.push(audio.duration);

    if (Reveal.isLastSlide()) {
      didStopGenerating();
      return;
    }

    Reveal.next();
  };
}

/**
 *
 * @param text
 * @returns {Promise<{ audioPlayer: HTMLAudioElement, audioChunks: Uint8Array }>}
 */
async function convertTextToSpeech(text) {
  return new Promise((resolve, reject) => {
    let audioChunks = [];

    if (!window.MediaSource) {
      console.error('MediaSource API is not supported in this browser');
      reject(new Error('MediaSource API is not supported in this browser'));
      return;
    }

    const audioPlayer = document.createElement("audio");
    audioPlayer.toggleAttribute("controls", true);
    audioPlayer.oncanplay = () => resolve({ audioPlayer, audioChunks });
    audioPlayer.onerror = () => reject(new Error("Error loading audio"));

    const mediaSource = new MediaSource();
    audioPlayer.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', async () => {
      const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');

      try {
        const response = fakeMode ? await fakeTTS(text) : await openAiTTS(text);

        if (response.body === null) {
          throw new Error('The fetch response body is null.');
        }

        const reader = response.body.getReader();
        await readChunk(reader, sourceBuffer);
      } catch (error) {
        console.error('Error in fetch:', error);
        reject(error);
      }
    });

    async function readChunk(reader, sourceBuffer) {
      if (shouldStopGenerating) throw new Error("Stop generating");

      try {
        const {done, value} = await reader.read();
        audioChunks.push(value);

        if (done) {
          mediaSource.endOfStream();
          return;
        }

        sourceBuffer.appendBuffer(value);

        sourceBuffer.addEventListener('updateend', () => {
          readChunk(reader, sourceBuffer);
        }, {once: true});
      } catch (error) {
        console.error('Error in readChunk:', error);
        mediaSource.endOfStream();
        throw error;
      }
    }
  });
}

// Downloading

function setDownloadProgress(fraction) {
  const percentString = Math.floor(fraction * 100).toString();
  document.getElementById("download-progress").innerHTML = `<span>${percentString}%</span>`;
}

function didStartDownloading() {
  isDownloading = true;
  document.getElementById("download").toggleAttribute("downloading", true);
  document.getElementById("download-icon").setAttribute("src", "img/stop.svg");
  document.querySelector(".download-progress-container").style.opacity = "1";
}

function didStopDownloading() {
  document.getElementById("download").toggleAttribute("downloading", false);
  document.getElementById("download-icon").setAttribute("src", "img/download.svg");
  document.querySelector(".download-progress-container").style.opacity = "0";
  isDownloading = false;
  didDownload = true;
  window.onbeforeunload = null;
}

window.toggleDownloadVideo = async function() {
  if (isDownloading) {
    shouldStopDownloading = true;
  } else {
    await downloadVideo();
  }
}

window.downloadVideo = async function() {
  didStartDownloading();
  try {
    downloadVideoMode = true;
    const slidesContainer = document.querySelector('.slides').children;
    for (let i = imageBlobs.length; i < slidesContainer.length; i++) {
      // First 50% is gathering images, second 50% is ffmpeg
      setDownloadProgress(0.5 * (imageBlobs.length / slidesContainer.length));
      Reveal.slide( i, 0, undefined );
      const promise = new Promise((resolve) => {
        setTimeout(async() => {
          const node = document.querySelector(`.reveal`);
          const canvas = await html2canvas(node);
          canvas.toBlob(
            (blob) => {
              imageBlobs.push(blob);
            },
            "image/png"
          );
          resolve();
        }, 0);
      })
      await promise;
    }
    downloadVideoMode = false;
    const content = await processAllPairs();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = `${videoTopic.replace(" ", "-")}_vlearn.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    console.error(e);
  }
  didStopDownloading();
}

// ffmpeg

const { FFmpeg } = FFmpegWASM;
let ffmpeg = null;

// Initialize and load FFmpeg
async function loadFFmpeg() {
  if (ffmpeg === null) {
    ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      console.log(message);
    });
    await ffmpeg.load({
      coreURL: "/js/dist/ffmpeg/ffmpeg-core.min.js",
    });
  }
}

async function processPair(imageBlob, audioBlob, index) {
  const imageArrayBuffer = await imageBlob.arrayBuffer();
  const imageUint8Array = new Uint8Array(imageArrayBuffer);
  const audioArrayBuffer = await audioBlob.arrayBuffer();
  const audioUint8Array = new Uint8Array(audioArrayBuffer);

  // Write files to FFmpeg's virtual file system
  await ffmpeg.writeFile(`input${index}.png`, imageUint8Array);
  await ffmpeg.writeFile(`input${index}.mp3`, audioUint8Array);

  // Extract duration of the audio file
  const duration = audioDurations[index];

  await ffmpeg.exec([
    '-y',
    '-loop', '1',
    '-framerate', '2',
    '-i', `input${index}.png`,
    '-i', `input${index}.mp3`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-t', duration.toString(), // Set the duration to match audio length
    '-tune', 'stillimage',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', 'yuv420p',
    '-shortest',
    `segment${index}.mp4`
  ]);
}

// Concatenate all segments into a single video
async function concatenateSegments(count) {
  // Create a file list for concatenation
  let fileList = '';
  for (let i = 0; i < count; i++) {
    fileList += `file 'segment${i}.mp4'\n`;
  }
  await ffmpeg.writeFile('filelist.txt', fileList);

  // Concatenate using the concat demuxer
  await ffmpeg.exec([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', 'filelist.txt',
    '-c', 'copy',
    'output.mp4'
  ]);

  const data = await ffmpeg.readFile('output.mp4');
  return new Blob([data.buffer], { type: 'video/mp4' });
}

// Process all pairs
async function processAllPairs() {
  await loadFFmpeg();
  setDownloadProgress(0.5);
  for (let i = 0; i < imageBlobs.length; i++) {
    if (shouldStopDownloading) throw Error("Aborted.");
    const audioBlob = new Blob(audioFiles[i].audioChunks, { type: 'audio/mpeg' });
    await processPair(imageBlobs[i], audioBlob, i);
    setDownloadProgress(0.5 + ((i + 1) / (imageBlobs.length + 1)) * 0.5);
  }
  if (shouldStopDownloading) throw Error("Aborted.");
  const final = await concatenateSegments(imageBlobs.length);
  setDownloadProgress(1);
  return final;
}

// Prompts

const slidesPrompt = (subject) => `You are helping build an educational intensive crash course which will help me learn "${subject}" which is about 4 minutes long.

Output JSON of 5-7 slides in markdown format with a short title (in the form of a conclusion that clearly teaches me a key concept), and optionally supporting text or supporting bullet points. If more text, such as a specific written example, will be helpful, include it as a blockquote.

If this relates to programming, include code (tagged with the language) on appropriate slides. For code: err on the side of including an example. Make sure to prepend \n to any code blocks (triple ticks). Only indent with 2 spaces, not 4 spaces.

Include mathematical formulae / equations where applicable.

If showing more text and clear examples would help to better teach "${subject}", then make this modification.

Consider teaching through examples if it will better teach "${subject}".

Focus on building intuition.

If there are multiple concepts involved in something, list them out as bullet points.

Unless it is a title slide, be sure to list bullet points outlining each of the key points.

Outlining the content for the script that will be written is vital.

One element in the array is an entire slide. Do not output it to the chat. Do not refer to this as an intensive crash course.

Use this only to understand the format of the JSON which should be created:

{
  "slides": [
    "# Electromagnetism and Gravity\n- Exploring the deep connections between electromagnetism and gravity",
    "# Electromagnetism is a gauge theory\n- Keeping things symmetric even when we change our perspective\n- Attempts to formulate gravity as a gauge theory",
    "# Kaluza-Klein Theory\n- Unification of electromagnetism and gravity\n- Extra dimensions and compactification",
  ],
}`;

const scriptPrompt = (subject, slides, slideCount) => `${slides}

--- end of slides ---

Notice that there are ${slideCount} slides.

The slides are in JSON format, featuring a list of all slides, each defined by markdown.

You should separate each per-slide script portion by six hyphens surrounded by newlines, like

------

Every single slide _MUST_ have a script portion. The number of script portions must be exactly ${slideCount}.

You must only output markdown.

You are helping build an educational intensive crash course which will help me learn "${subject}", which is about 4 minutes long.

Your job is to output a complete script for the video, based on the above slides.

Clearly teach me about the subject, as defined by the slides above.

It is vital that I gain intuition for all presented concepts. This is more important than anything else.

I should be able to take a test on the subject and pass it.

Use casual and articulate speech. Avoid jargon.

Do not say "it's like" or "it was like".

Do not make comparisons. Do not use similes. Do not use metaphors.

Any references or comparisons must be accurate, clear and obvious. Do not force metaphors.

Let me repeat, do not use metaphors or similes.

Prefer literal visuals over esoteric.

Be accurate.

Do not include an introduction or welcome. Do not talk about what we are going to do - just start teaching. Do not include a conclusion. Don't wrap up. Don't talk about the instructions.

Ensure the piece flows very well. Start and end in unique ways. Spell out any symbols. Mention any uncertainty with material presented. Include summarizations of mathematical formulae where applicable. Do not read formulae verbatim. Don't talk about how complex formulae are.

Never just list concepts or tell me what they are "like". Teach me the intuition behind each one.

For example, if there are 3 concepts involved in something, explain each one individually, don't just list what they are like.

Be detailed and thorough in explanations and comparisons.

If giving more explicit examples would help to better teach the slide content, then make this modification.

Consider modifying how the script should be written to better teach the slide content. Do not change the output format.

Before sending the final script - check it over. Are there any factual inaccuracies? Did you violate any of the rules?

Ensure the script is information rich and follows the slides markdown well. See if you can improve how you open the script, where you leave the script, and the general flow and any references you made.

Ask yourself, should more examples be given throughout the script to better teach the material?

If it will help teach the material, suggest thought exercises to me.

Let me reiterate: It is vital that I gain intuition for each and every presented concept.

Remember that every slide needs a portion of the script, and it should relate to the slide content.

You should separate each per-slide script portion by six hyphens surrounded by newlines, like

------

# VERY IMPORTANT

Every single slide _MUST_ have a script portion. The number of script portions must be exactly ${slideCount}.

Never compare anything to a "dance" unless the subject is specifically about dance.

Remember I will have the slides from before. Do not output it to the chat.`

// OpenAI API
async function getMarkdownSlides(subject) {
  const apiKey = document.getElementById("apiKey").value.trim();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          "role": "user",
          "content": slidesPrompt(subject),
        }
      ],
      tools: [
        {
          "type": "function",
          "function": {
            "name": "get_slides",
            "description": "Get the educational video markdown slides for the provided subject",
            "parameters": {
              "type": "object",
              "properties": {
                "slides": {
                  "description": "An array of the educational video slides in markdown format",
                  "type": "array",
                  "items": {
                    "description": "Markdown for this slide",
                    "type": "string"
                  }
                },
              },
              "required": ["slides"],
            },
          },
        }
      ],
      tool_choice: {"type": "function", "function": {"name": "get_slides"}},
    }),
    signal: stopController.signal
  });

  const response_data = await response.json();
  const response_message = response_data.choices[0].message
  return JSON.parse(response_message.tool_calls[0].function.arguments).slides.filter((a) => a.trim().length);
}

async function getAPICompletion(content) {
  const apiKey = document.getElementById("apiKey").value.trim();

  // Fetch response from the API
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          "role": "user",
          "content": content,
        }
      ],
      stream: true,
    }),
    signal: stopController.signal
  });

  // Validate response
  if (!response.body) {
    throw new Error("No response body");
  }
  return response.body;
}

function openAiTTS(text) {
  const apiKey = document.getElementById("apiKey").value.trim();
  const url = 'https://api.openai.com/v1/audio/speech';

  const headers = new Headers();
  headers.append('Authorization', `Bearer ${apiKey}`);
  headers.append('Content-Type', 'application/json');

  const data = JSON.stringify({
    model: 'tts-1',
    input: text,
    voice: 'onyx',
    // speed: 1.5,
  });

  return fetch(url, {
    method: 'POST',
    headers: headers,
    body: data,
    signal: stopController.signal
  });
}

// Mock Methods

function fakeTTS(text) {
  const url = 'http://localhost:8000/speech.mp3';
  return fetch(url);
}

const fakeSlides = () => JSON.parse("{\n  \"slides\": [\n    \"# Introduction to Astrophysics\",\n    \"## What is Astrophysics?\",\n    \"- The branch of astronomy that deals with the physics of celestial objects and phenomena\",\n    \"- Involves studying the properties and behavior of stars, galaxies, and the universe as a whole\",\n    \"- Combines principles from physics, mathematics, and chemistry to understand the nature of the universe\",\n    \"---\",\n    \"# Scale of the Universe\",\n    \"- The universe is vast and consists of objects of varying sizes and distances\",\n    \"> #### Example:\",\n    \"> - The Earth is approximately 149.6 million kilometers away from the Sun\",\n    \"> - The nearest star to our solar system, Proxima Centauri, is about 40 trillion kilometers away\",\n    \"> - Our Milky Way galaxy has a diameter of about 100,000 light-years\",\n    \"> - There are billions of galaxies in the observable universe\",\n    \"---\",\n    \"# Stellar Evolution\",\n    \"- Stars go through various stages of evolution\",\n    \"- Birth: Formation of a star from a massive cloud of gas and dust\",\n    \"- Main Sequence: Stable period where a star generates energy through nuclear fusion\",\n    \"- Red Giant: Expansion of the star as it runs out of nuclear fuel\",\n    \"> #### Example:\",\n    \"> - Our Sun will eventually become a red giant in about 5 billion years\",\n    \"- Supernova: Explosion of a massive star at the end of its life\",\n    \"> #### Example:\",\n    \"> - Supernovae can release more energy in a few days than the Sun does in its entire lifetime\",\n    \"---\",\n    \"# The Big Bang Theory\",\n    \"- The prevailing explanation for the origin of the universe\",\n    \"- Suggests that the universe started as a singularity and has been expanding ever since\",\n    \"- Supports the observed redshift of galaxies as evidence for the expansion\",\n    \"- 13.8 billion years ago, the universe was extremely hot and dense\",\n    \"> #### Formula:\",\n    \"> - Hubble's Law: v = H₀d\",\n    \">   - v is the velocity of a galaxy\",\n    \">   - H₀ is the Hubble constant\",\n    \">   - d is the distance to the galaxy\",\n    \"---\",\n    \"# Dark Matter and Dark Energy\",\n    \"- The majority of the universe is made up of dark matter and dark energy\",\n    \"- Dark matter: Matter that does not interact with light or other forms of electromagnetic radiation\",\n    \"- Dark energy: A hypothetical form of energy that permeates all of space and drives the accelerated expansion of the universe\",\n    \"> #### Example:\",\n    \"> - Dark matter makes up about 27% of the universe, while dark energy accounts for about 68%\",\n    \"---\",\n    \"# Conclusion\",\n    \"- Astrophysics is the study of the physical properties and behavior of celestial objects and phenomena\",\n    \"- The universe is vast and consists of objects of varying sizes and distances\",\n    \"- Stars go through various stages of evolution, from birth to supernova\",\n    \"- The Big Bang Theory explains the origin of the universe and its ongoing expansion\",\n    \"- Dark matter and dark energy are mysterious components that make up the majority of the universe\"\n  ]\n}").slides;

const fakeStreamedScriptLines = () => ([
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"---\\n\\n\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Alright\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"y\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" then\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\",\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" let\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"'s\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" dive\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" right\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" into\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" the\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" fascinating\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" world\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" of\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" ast\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"roph\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ysics\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"!\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" Today\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\",\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" we\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"'re\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" going\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" to\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" explore\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" the\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" physics\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" of\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" celestial\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" objects\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" and\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" phenomena\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\".\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" But\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" what\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" exactly\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" is\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" ast\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"roph\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ysics\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"?\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" Well\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\",\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" it\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"'s\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" a\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" branch\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" of\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" astronomy\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" that\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" combines\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" principles\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" from\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" physics\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\",\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" mathematics\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\",\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" and\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" chemistry\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" to\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" help\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" us\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" understand\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" the\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" nature\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" of\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" the\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" universe\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\".\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" Think\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" of\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" it\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" as\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" the\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" ultimate\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" cosmic\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" puzzle\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\",\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" where\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" we\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" get\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" to\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" unravel\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" the\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" mysteries\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" of\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" stars\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\",\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" galaxies\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\",\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" and\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" the\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" universe\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" as\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" a\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\" whole\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\".\\n\\n\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"---\\n\\n\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Now\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{\"content\":\",\"},\"logprobs\":null,\"finish_reason\":null}]}",
  "data: {\"id\":\"chatcmpl-8ePqkhfxBIkJdcggDcg25l5sH6KZW\",\"object\":\"chat.completion.chunk\",\"created\":1704643178,\"model\":\"gpt-3.5-turbo-0613\",\"system_fingerprint\":null,\"choices\":[{\"index\":0,\"delta\":{},\"logprobs\":null,\"finish_reason\":\"length\"}]}",
  "data: [DONE]",
]);
