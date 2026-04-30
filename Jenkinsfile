pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  parameters {
    string(name: 'IMAGE_TAG', defaultValue: '', description: '비워두면 git short sha를 이미지 태그로 사용합니다.')
    booleanParam(name: 'RUN_TESTS', defaultValue: false, description: 'TODO: 테스트 스크립트 추가 후 true로 전환하세요.')
    booleanParam(name: 'PUSH_IMAGE', defaultValue: true, description: 'Harbor push 여부')
    booleanParam(name: 'DEPLOY', defaultValue: false, description: 'TODO: ArgoCD/Jenkins 배포 연동 후 true로 사용')
  }

  environment {
    HARBOR_REGISTRY = 'TODO_HARBOR_REGISTRY'
    HARBOR_PROJECT = 'TODO_HARBOR_PROJECT'
    HARBOR_CREDENTIALS_ID = 'TODO_HARBOR_CREDENTIALS_ID'
    IMAGE_PREFIX = 'team9-'
    IMAGE_NAME = 'redis-stream-mongo-consumer'
    DOCKER_CONTEXT = '.'
    DOCKERFILE = 'Dockerfile'
    PLATFORM = 'linux/amd64'
    TEST_COMMAND = 'TODO_ADD_TEST_COMMAND'
    DEPLOY_TARGET = 'TODO_ARGOCD_APP_OR_MANIFEST_REPO'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Prepare') {
      steps {
        script {
          env.RESOLVED_IMAGE_TAG = params.IMAGE_TAG?.trim()
            ? params.IMAGE_TAG.trim()
            : sh(returnStdout: true, script: 'git rev-parse --short=12 HEAD').trim()
          env.IMAGE_REF = "${env.HARBOR_REGISTRY}/${env.HARBOR_PROJECT}/${env.IMAGE_PREFIX}${env.IMAGE_NAME}:${env.RESOLVED_IMAGE_TAG}"
          echo "Image: ${env.IMAGE_REF}"
        }
      }
    }

    stage('Test') {
      when { expression { return params.RUN_TESTS } }
      steps {
        error 'TODO: package.json의 test 스크립트를 실제 검증 명령으로 교체한 뒤 TEST_COMMAND를 설정하세요.'
      }
    }

    stage('Docker Build') {
      steps {
        sh '''
          docker buildx build \
            --platform "$PLATFORM" \
            --load \
            -f "$DOCKERFILE" \
            -t "$IMAGE_REF" \
            "$DOCKER_CONTEXT"
        '''
      }
    }

    stage('Docker Push') {
      when { expression { return params.PUSH_IMAGE } }
      steps {
        withCredentials([usernamePassword(credentialsId: env.HARBOR_CREDENTIALS_ID, usernameVariable: 'HARBOR_USER', passwordVariable: 'HARBOR_PASSWORD')]) {
          sh '''
            echo "$HARBOR_PASSWORD" | docker login "$HARBOR_REGISTRY" -u "$HARBOR_USER" --password-stdin
            docker push "$IMAGE_REF"
          '''
        }
      }
    }

    stage('Deploy') {
      when { expression { return params.DEPLOY } }
      steps {
        echo 'TODO: ArgoCD app sync 또는 manifest repo image tag update를 여기에 연결하세요.'
        echo "TODO target: ${env.DEPLOY_TARGET}"
      }
    }
  }
}
