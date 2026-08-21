import { DefaultAzureCredential } from '@azure/identity';

const credential = new DefaultAzureCredential();

export function azureSpeechConfigured() {
  return Boolean(process.env.AZURE_SPEECH_ENDPOINT && process.env.AZURE_SPEECH_RESOURCE_ID);
}

export function speechRecognitionUrl(endpoint: string) {
  return `${endpoint.replace(/\/$/, '')}/stt/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
}

export function speechAuthorization(resourceId: string, accessToken: string) {
  return `Bearer aad#${resourceId}#${accessToken}`;
}

export async function transcribeWav(audio: Buffer) {
  if (!azureSpeechConfigured()) throw new Error('Azure Speech is not configured');
  if (audio.length < 48 || audio.subarray(0, 4).toString('ascii') !== 'RIFF' || audio.subarray(8, 12).toString('ascii') !== 'WAVE') throw new Error('Expected WAV audio');
  const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
  if (!token) throw new Error('Azure managed identity could not get a Speech token');
  const endpoint = process.env.AZURE_SPEECH_ENDPOINT!.replace(/\/$/, '');
  const resourceId = process.env.AZURE_SPEECH_RESOURCE_ID!;
  const response = await fetch(speechRecognitionUrl(endpoint), {
    method: 'POST',
    headers: {
      Authorization: speechAuthorization(resourceId, token.token),
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
      Accept: 'application/json',
    },
    body: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer,
  });
  if (!response.ok) throw new Error(`Azure Speech request failed (${response.status})`);
  const body = await response.json() as { RecognitionStatus?: string; DisplayText?: string; NBest?: { Display?: string }[] };
  const transcript = body.DisplayText || body.NBest?.[0]?.Display;
  if (body.RecognitionStatus !== 'Success' || !transcript) throw new Error('Speech was not recognized');
  return transcript;
}
