import type {
  CreatedRoomInvite,
  GuestJoinInput,
  GuestJoinResult,
  Room,
  RoomAccess,
  RoomInviteView,
} from '@streamkit/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const roomKeys = {
  all: ['rooms'] as const,
  detail: (id: string) => ['rooms', id] as const,
  invites: (id: string) => ['rooms', id, 'invites'] as const,
};

export function useRooms() {
  return useQuery({
    queryKey: roomKeys.all,
    queryFn: () => api.get<Room[]>('/rooms'),
  });
}

export function useRoom(id: string) {
  return useQuery({
    queryKey: roomKeys.detail(id),
    queryFn: () => api.get<Room>(`/rooms/${id}`),
  });
}

export function useCreateRoom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<Room>('/rooms', { name }),
    onSuccess: () => client.invalidateQueries({ queryKey: roomKeys.all }),
  });
}

export function useDeleteRoom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/rooms/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: roomKeys.all }),
  });
}

export function useInvites(roomId: string) {
  return useQuery({
    queryKey: roomKeys.invites(roomId),
    queryFn: () => api.get<RoomInviteView[]>(`/rooms/${roomId}/invites`),
  });
}

export function useCreateInvite(roomId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (label: string) =>
      api.post<CreatedRoomInvite>(`/rooms/${roomId}/invites`, { label }),
    onSuccess: () => client.invalidateQueries({ queryKey: roomKeys.invites(roomId) }),
  });
}

export function useRevokeInvite(roomId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api.delete<void>(`/rooms/${roomId}/invites/${inviteId}`),
    onSuccess: () => client.invalidateQueries({ queryKey: roomKeys.invites(roomId) }),
  });
}

/**
 * Доступ стримера к комнате — мутация, а не запрос.
 *
 * Токен живёт пять минут и нужен ровно в момент входа: кэшировать его как
 * данные значило бы однажды войти с протухшим.
 */
export function useHostAccess(roomId: string) {
  return useMutation({
    mutationFn: () => api.post<RoomAccess>(`/rooms/${roomId}/host-access`),
  });
}

export function useRemoveGuest(roomId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ identity, revoke }: { identity: string; revoke: boolean }) =>
      api.post<void>(
        `/rooms/${roomId}/participants/${encodeURIComponent(identity)}/remove${revoke ? '?revoke=true' : ''}`,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: roomKeys.invites(roomId) }),
  });
}

/**
 * Выключить гостю микрофон или разрешить обратно.
 *
 * Не «заглушить дорожку», которую гость включил бы той же кнопкой, а отнять
 * право на микрофон. Разрешение возвращает право, но микрофон гость включает сам.
 */
export function useGuestMicrophone(roomId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ identity, blocked }: { identity: string; blocked: boolean }) =>
      api.post<void>(
        `/rooms/${roomId}/participants/${encodeURIComponent(identity)}/${blocked ? 'mute' : 'unmute'}`,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: roomKeys.invites(roomId) }),
  });
}

/** Вход гостя. Без сессии: гость не зарегистрирован, у него есть только ссылка. */
export function useGuestJoin() {
  return useMutation({
    mutationFn: (input: GuestJoinInput) => api.post<GuestJoinResult>('/rooms/join', input),
  });
}
