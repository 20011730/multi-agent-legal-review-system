package com.legalreview.controller;

import com.legalreview.dto.request.AccountUpdateRequest;
import com.legalreview.dto.request.ProfileUpdateRequest;
import com.legalreview.dto.response.ProfileResponse;
import com.legalreview.service.ProfileService;
import com.legalreview.service.UserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class ProfileController {

    private final ProfileService profileService;
    private final UserService userService;

    /**
     * 사용자 프로필 조회
     * GET /api/users/{userId}/profile
     */
    @GetMapping("/{userId}/profile")
    public ResponseEntity<?> getProfile(@PathVariable Long userId) {
        try {
            ProfileResponse response = profileService.getProfile(userId);
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 사용자 프로필 저장/수정
     * PUT /api/users/{userId}/profile
     */
    @PutMapping("/{userId}/profile")
    public ResponseEntity<?> updateProfile(
            @PathVariable Long userId,
            @Valid @RequestBody ProfileUpdateRequest request) {
        try {
            ProfileResponse response = profileService.updateProfile(userId, request);
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 계정 기본 정보 수정
     * PUT /api/users/{userId}/account
     */
    @PutMapping("/{userId}/account")
    public ResponseEntity<?> updateAccount(
            @PathVariable Long userId,
            @Valid @RequestBody AccountUpdateRequest request) {
        try {
            return ResponseEntity.ok(userService.updateAccount(userId, request));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 회원 탈퇴
     * DELETE /api/users/{userId}
     */
    @DeleteMapping("/{userId}")
    public ResponseEntity<?> deleteAccount(@PathVariable Long userId) {
        try {
            userService.deleteAccount(userId);
            return ResponseEntity.ok(Map.of("message", "회원 탈퇴가 완료되었습니다."));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404)
                    .body(Map.of("error", e.getMessage()));
        }
    }
}
