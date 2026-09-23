/**
 * Сервис чата YouTube `V3DataLiveChatMessageService.StreamList` — gRPC.
 *
 * Выдержка из официального `stream_list.proto`
 * (https://developers.google.com/youtube/v3/live/streaming-live-chat, Apache 2.0):
 * только то, что мы читаем. Номера полей — официальные и меняться не могут;
 * неизвестные поля proto2 при разборе пропускает, так что опросы и подарки,
 * которых здесь нет, ответ не ломают.
 *
 * Номер поля, списанный неверно, не даёт ошибки: разбор просто пропустит его, и
 * суперчат приедет без суммы. Поэтому сверять их — только с официальным
 * `stream_list.proto` на странице документации, а не по памяти.
 *
 * Строкой в коде, а не файлом `.proto` рядом: файл пришлось бы отдельно
 * копировать в `dist` и не потерять в `pnpm deploy`. Потерянный ассет
 * обнаружился бы только в рантайме, на первом эфире.
 */
export const YOUTUBE_CHAT_PROTO = `
syntax = "proto2";
package youtube.api.v3;

service V3DataLiveChatMessageService {
  rpc StreamList(LiveChatMessageListRequest) returns (stream LiveChatMessageListResponse) {}
}

message LiveChatMessageListRequest {
  optional string live_chat_id = 1;
  optional string hl = 2;
  optional uint32 profile_image_size = 3;
  optional uint32 max_results = 98;
  optional string page_token = 99;
  repeated string part = 100;
}

message LiveChatMessageListResponse {
  optional string kind = 200;
  optional string etag = 201;
  optional string offline_at = 2;
  optional string next_page_token = 100602;
  repeated LiveChatMessage items = 1007;
}

message LiveChatMessage {
  optional string kind = 200;
  optional string etag = 201;
  optional string id = 101;
  optional LiveChatMessageSnippet snippet = 2;
  optional LiveChatMessageAuthorDetails author_details = 3;
}

message LiveChatMessageAuthorDetails {
  optional string channel_id = 10101;
  optional string channel_url = 102;
  optional string display_name = 103;
  optional string profile_image_url = 104;
  optional bool is_verified = 4;
  optional bool is_chat_owner = 5;
  optional bool is_chat_sponsor = 6;
  optional bool is_chat_moderator = 7;
}

message LiveChatMessageSnippet {
  message TypeWrapper {
    enum Type {
      INVALID_TYPE = 0;
      TEXT_MESSAGE_EVENT = 1;
      TOMBSTONE = 2;
      FAN_FUNDING_EVENT = 3;
      CHAT_ENDED_EVENT = 4;
      SPONSOR_ONLY_MODE_STARTED_EVENT = 5;
      SPONSOR_ONLY_MODE_ENDED_EVENT = 6;
      NEW_SPONSOR_EVENT = 7;
      MEMBER_MILESTONE_CHAT_EVENT = 17;
      MEMBERSHIP_GIFTING_EVENT = 18;
      GIFT_MEMBERSHIP_RECEIVED_EVENT = 19;
      USER_BANNED_EVENT = 10;
      SUPER_CHAT_EVENT = 15;
      SUPER_STICKER_EVENT = 16;
      POLL_EVENT = 20;
      GIFT_EVENT = 21;
    }
  }
  optional TypeWrapper.Type type = 1;
  optional string live_chat_id = 201;
  optional string author_channel_id = 301;
  optional string published_at = 4;
  optional bool has_display_content = 17;
  optional string display_message = 16;
  oneof displayed_content {
    LiveChatTextMessageDetails text_message_details = 19;
    LiveChatSuperChatDetails super_chat_details = 27;
    LiveChatSuperStickerDetails super_sticker_details = 28;
    LiveChatNewSponsorDetails new_sponsor_details = 29;
    LiveChatMemberMilestoneChatDetails member_milestone_chat_details = 30;
    LiveChatMembershipGiftingDetails membership_gifting_details = 31;
  }
}

message LiveChatTextMessageDetails {
  optional string message_text = 1;
}

message LiveChatSuperChatDetails {
  optional uint64 amount_micros = 1;
  optional string currency = 2;
  optional string amount_display_string = 3;
  optional string user_comment = 4;
  optional uint32 tier = 5;
}

message LiveChatSuperStickerDetails {
  optional uint64 amount_micros = 1;
  optional string currency = 2;
  optional string amount_display_string = 3;
  optional uint32 tier = 4;
  optional SuperStickerMetadata super_sticker_metadata = 5;
}

message SuperStickerMetadata {
  optional string sticker_id = 1;
  optional string alt_text = 2;
  optional string alt_text_language = 3;
}

message LiveChatNewSponsorDetails {
  optional string member_level_name = 1;
  optional bool is_upgrade = 2;
}

message LiveChatMemberMilestoneChatDetails {
  optional string member_level_name = 1;
  optional uint32 member_month = 2;
  optional string user_comment = 3;
}

message LiveChatMembershipGiftingDetails {
  optional int32 gift_memberships_count = 1;
  optional string gift_memberships_level_name = 2;
}
`;

/** Разобранные сообщения — как их отдаёт proto-loader с `enums: String`. */
export interface YouTubeChatAuthor {
  channelId?: string;
  displayName?: string;
  isVerified?: boolean;
  isChatOwner?: boolean;
  isChatSponsor?: boolean;
  isChatModerator?: boolean;
}

export interface YouTubeChatItem {
  id?: string;
  snippet?: {
    type?: string;
    authorChannelId?: string;
    publishedAt?: string;
    displayMessage?: string;
    textMessageDetails?: { messageText?: string };
    /**
     * Суммы приходят в микро (1 750 000 = 1,75) и числом, которое не помещается
     * в 32 бита, поэтому protobufjs отдаёт их строкой (`longs: String`).
     */
    superChatDetails?: {
      amountMicros?: string | number;
      currency?: string;
      amountDisplayString?: string;
      userComment?: string;
    };
    superStickerDetails?: {
      amountMicros?: string | number;
      currency?: string;
      amountDisplayString?: string;
      superStickerMetadata?: { altText?: string };
    };
    newSponsorDetails?: { memberLevelName?: string; isUpgrade?: boolean };
    memberMilestoneChatDetails?: {
      memberLevelName?: string;
      memberMonth?: number;
      userComment?: string;
    };
    membershipGiftingDetails?: {
      giftMembershipsCount?: number;
      giftMembershipsLevelName?: string;
    };
  };
  authorDetails?: YouTubeChatAuthor;
}

export interface YouTubeChatResponse {
  offlineAt?: string;
  nextPageToken?: string;
  items?: YouTubeChatItem[];
}

export interface YouTubeChatRequest {
  liveChatId: string;
  part: string[];
  pageToken?: string;
  profileImageSize?: number;
}
