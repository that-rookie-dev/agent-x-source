import React from 'react';
import { MedicalDisclaimerChatSessionStrip } from '../crew/MedicalDisclaimerBanner';
import { ChatWarningBand } from './ChatWarningBand';
import {
  useChatMessagesContext,
  useChatSessionPrivacyContext,
  useChatCrewListContext,
  useChatInputGateContext,
  useChatModelDataContext,
  useChatSessionSettersContext,
} from './ChatSessionProvider';

export const ChatBanners = React.memo(function ChatBanners() {
  // Message thread values — re-renders on stream chunks (needed for messages + warnings).
  const { messages, warnings } = useChatMessagesContext();
  // Session privacy.
  const {
    isCrewPrivateSession, crewPrivateHost, privateHostCrewId,
  } = useChatSessionPrivacyContext();
  // Crew list.
  const { crewList } = useChatCrewListContext();
  // Input gate state.
  const { sendBlocked, sendBlockedReason } = useChatInputGateContext();
  // Model / provider data.
  const { configLoaded } = useChatModelDataContext();
  const { setWarnings } = useChatSessionSettersContext();

  return (
    <>
      <MedicalDisclaimerChatSessionStrip
        isCrewPrivateSession={isCrewPrivateSession}
        crewPrivateHost={crewPrivateHost}
        privateHostCrewId={privateHostCrewId}
        crewList={crewList}
        messages={messages}
      />

      <ChatWarningBand
        warnings={warnings}
        sendBlocked={sendBlocked}
        sendBlockedReason={sendBlockedReason}
        configLoaded={configLoaded}
        onDismiss={() => setWarnings([])}
      />
    </>
  );
});
