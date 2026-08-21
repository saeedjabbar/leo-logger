import { describe, expect, it } from 'vitest';
import { speechAuthorization, speechRecognitionUrl } from './speech.js';

describe('Azure Speech managed identity request', () => {
  it('uses the resource custom domain for short-audio recognition', () => {
    expect(speechRecognitionUrl('https://baby-ai.cognitiveservices.azure.com/')).toBe(
      'https://baby-ai.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed',
    );
  });

  it('wraps an Entra token with the required Azure resource ID', () => {
    expect(speechAuthorization('/subscriptions/test/resourceGroups/family/providers/Microsoft.CognitiveServices/accounts/baby-ai', 'token')).toBe(
      'Bearer aad#/subscriptions/test/resourceGroups/family/providers/Microsoft.CognitiveServices/accounts/baby-ai#token',
    );
  });
});
